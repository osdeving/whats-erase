import type { FastifyBaseLogger } from 'fastify';

import type { AuditLogStore, AuditLogLevel } from './audit-log-store.js';
import type { JobsStore } from './jobs-store.js';
import type { RulesStore } from './rules-store.js';
import type { SettingsStore } from './settings-store.js';
import { EvolutionClient, EvolutionError, summarizeDeleteAcknowledgement } from './evolution-client.js';
import { decideRule } from './rule-engine.js';
import type { ClaimedJob, ParsedMessage } from '../types.js';

const MAX_DELETE_AGE_MS = 48 * 60 * 60 * 1000;

export class DeletionWorker {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastTick: Date | null = null;
  private lastError: string | null = null;
  private lastWebhookSync = 0;
  private acceptingWork = false;
  private generation = 0;

  constructor(
    private readonly jobs: JobsStore,
    private readonly rules: RulesStore,
    private readonly settings: SettingsStore,
    private readonly logger: FastifyBaseLogger,
    private readonly pollMs: number,
    private readonly audit?: AuditLogStore,
  ) {}

  private async record(
    level: AuditLogLevel,
    event: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    if (!this.audit) return;
    try {
      await this.audit.write(level, event, message, details);
    } catch {
      this.logger.warn({ event }, 'Falha ao persistir log operacional');
    }
  }

  async start() {
    await this.jobs.recoverExpiredLeases();
    this.acceptingWork = (await this.settings.get()).daemonEnabled;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref();
    await this.tick();
  }

  stop() {
    this.pause();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    return { running: this.timer !== null, busy: this.busy, lastTick: this.lastTick, lastError: this.lastError };
  }

  resume() {
    this.generation += 1;
    this.acceptingWork = true;
  }

  pause() {
    this.acceptingWork = false;
    this.generation += 1;
  }

  async reconcileWebhook(force = false) {
    const settings = await this.settings.get();
    if (!settings.daemonEnabled && !force) return;
    const now = Date.now();
    if (!force && now - this.lastWebhookSync < 5 * 60 * 1000) return;
    const connection = await this.settings.getEvolutionConnection();
    const client = new EvolutionClient(connection);
    const secret = await this.settings.getWebhookSecret();
    await client.configureWebhook(settings.webhookUrl, secret);
    this.lastWebhookSync = now;
  }

  private async process(job: ClaimedJob, dryRun: boolean, generation: number) {
    if (!this.acceptingWork || generation !== this.generation) {
      await this.jobs.releaseClaim(job.id);
      await this.record('info', 'job.released', 'Job devolvido para a fila porque o daemon foi pausado.', {
        jobId: job.id,
        attemptCount: job.attemptCount,
      });
      return;
    }
    if (job.isTest || job.simulateOnly || dryRun) {
      await this.jobs.markSucceeded(job.id, true);
      await this.record('info', 'job.simulated', 'Job processado em modo de simulacao.', {
        jobId: job.id,
        messageType: job.messageType,
        isTest: job.isTest,
        attemptCount: job.attemptCount,
      });
      return;
    }
    if (Date.now() - job.sentAt.getTime() >= MAX_DELETE_AGE_MS) {
      await this.jobs.markFailure(
        job,
        'DELETE_WINDOW_EXPIRED',
        'A mensagem ultrapassou o limite de 48 horas para solicitar apagar para todos.',
        true,
      );
      await this.record('error', 'job.failed', 'Job falhou porque a janela de exclusao expirou.', {
        jobId: job.id,
        errorCode: 'DELETE_WINDOW_EXPIRED',
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
      });
      return;
    }

    const activeRules = await this.rules.list();
    const ruleMessage: ParsedMessage = {
      instance: job.instanceName,
      remoteJid: job.remoteJid,
      participant: job.participant,
      messageId: job.messageId,
      fromMe: true,
      messageType: job.messageType,
      sentAt: job.sentAt,
    };
    const currentDecision = decideRule(ruleMessage, activeRules, 1);
    if (currentDecision.action === 'keep') {
      await this.jobs.markCancelledByRule(job.id, currentDecision.ruleName);
      await this.record('warn', 'job.cancelled', 'Job cancelado por uma regra de protecao ativa.', {
        jobId: job.id,
        ruleId: currentDecision.ruleId,
        attemptCount: job.attemptCount,
      });
      return;
    }

    try {
      if (!this.acceptingWork || generation !== this.generation) {
        await this.jobs.releaseClaim(job.id);
        await this.record('info', 'job.released', 'Job devolvido para a fila porque o daemon foi pausado.', {
          jobId: job.id,
          attemptCount: job.attemptCount,
        });
        return;
      }
      const connection = await this.settings.getEvolutionConnection();
      const client = new EvolutionClient({ ...connection, instanceName: job.instanceName });
      const response = await client.deleteForEveryone({
        id: job.messageId,
        remoteJid: job.remoteJid,
        participant: job.participant,
      });
      await this.jobs.markSucceeded(job.id, false);
      await this.record('info', 'job.delete_requested', 'Evolution aceitou a solicitacao HTTP; confirmacao do WhatsApp indisponivel.', {
        jobId: job.id,
        messageType: job.messageType,
        attemptCount: job.attemptCount,
        acceptedByEvolution: true,
        acknowledgement: summarizeDeleteAcknowledgement(response),
      });
    } catch (error) {
      if (error instanceof EvolutionError) {
        await this.jobs.markFailure(job, error.code, error.message, error.permanent);
        const failed = error.permanent || job.attemptCount >= job.maxAttempts;
        await this.record(failed ? 'error' : 'warn', failed ? 'job.failed' : 'job.retry_scheduled', failed
          ? 'Job de exclusao falhou definitivamente.'
          : 'Falha temporaria; uma nova tentativa foi agendada.', {
          jobId: job.id,
          errorCode: error.code,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
        });
        if (error.pausesDaemon) {
          this.pause();
          await this.settings.stopDaemon();
          this.lastError = `${error.code}: daemon pausado`;
          await this.record('error', 'daemon.paused_on_error', 'Daemon pausado apos erro permanente da Evolution.', {
            errorCode: error.code,
            jobId: job.id,
          });
        }
        return;
      }
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Erro desconhecido no worker';
      await this.jobs.markFailure(job, 'WORKER_ERROR', message, false);
      const failed = job.attemptCount >= job.maxAttempts;
      await this.record(failed ? 'error' : 'warn', failed ? 'job.failed' : 'job.retry_scheduled', failed
        ? 'Job falhou apos esgotar as tentativas.'
        : 'Erro interno temporario; uma nova tentativa foi agendada.', {
        jobId: job.id,
        errorCode: 'WORKER_ERROR',
        errorType: error instanceof Error ? error.name : 'UnknownError',
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
      });
    }
  }

  async tick() {
    if (this.busy || !this.acceptingWork) return;
    this.busy = true;
    this.lastTick = new Date();
    try {
      const current = await this.settings.get();
      if (!current.daemonEnabled) {
        this.acceptingWork = false;
        return;
      }
      const generation = this.generation;
      try {
        await this.reconcileWebhook();
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : 'Falha ao reconciliar webhook';
        this.logger.warn({ err: this.lastError }, 'Falha ao reconciliar webhook da Evolution');
        await this.record('warn', 'webhook.reconciliation_failed', 'Falha ao reconciliar o webhook da Evolution.', {
          errorCode: error instanceof EvolutionError ? error.code : 'WEBHOOK_RECONCILIATION_ERROR',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
      }
      const claimed = await this.jobs.claim();
      // Keep WhatsApp revoke requests serialized: this also lets Stop/auth failures
      // release the remainder of a claimed batch before more requests are sent.
      for (const job of claimed) {
        await this.process(job, current.dryRun, generation);
      }
      if (claimed.length > 0 && this.acceptingWork) this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Falha desconhecida';
      this.logger.error({ err: this.lastError }, 'Falha no ciclo do worker');
      await this.record('error', 'worker.cycle_failed', 'Falha inesperada no ciclo do worker.', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.busy = false;
    }
  }
}
