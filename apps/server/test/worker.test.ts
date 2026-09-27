import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClaimedJob, Rule } from '../src/types.js';
import type { AuditLogStore } from '../src/services/audit-log-store.js';
import type { JobsStore } from '../src/services/jobs-store.js';
import type { RulesStore } from '../src/services/rules-store.js';
import type { SettingsStore } from '../src/services/settings-store.js';
import { DeletionWorker } from '../src/services/worker.js';

const job: ClaimedJob = {
  id: 'job-1',
  instanceName: 'personal',
  remoteJid: '5511@s.whatsapp.net',
  participant: null,
  messageId: 'MSG-1',
  messageType: 'text',
  sentAt: new Date(),
  deleteAt: new Date(),
  attemptCount: 1,
  maxAttempts: 5,
  isTest: false,
  simulateOnly: false,
  ruleId: 'rule-1',
  ruleUpdatedAt: '2026-09-26T18:00:00.000Z',
};

const textRule: Rule = {
  id: 'rule-1',
  name: 'Comando temporario',
  priority: 10,
  chatKind: 'exact',
  chatJid: '5511@s.whatsapp.net',
  messageType: 'text',
  contentFilter: 'startsWith',
  contentPattern: '/tmp ',
  caseSensitive: false,
  action: 'delete',
  delaySeconds: 60,
  enabled: true,
  createdAt: new Date('2026-09-26T18:00:00.000Z'),
  updatedAt: new Date('2026-09-26T18:00:00.000Z'),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeletionWorker', () => {
  it('devolve o lease sem consumir tentativa quando Stop ocorre durante o claim', async () => {
    let finishClaim: (jobs: ClaimedJob[]) => void = () => undefined;
    const claimPromise = new Promise<ClaimedJob[]>((resolve) => {
      finishClaim = resolve;
    });
    const jobs = {
      recoverExpiredLeases: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockReturnValue(claimPromise),
      releaseClaim: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobsStore;
    const settings = {
      get: vi.fn().mockResolvedValue({ daemonEnabled: true, dryRun: false }),
      getEvolutionConnection: vi.fn(),
    } as unknown as SettingsStore;
    const rules = { list: vi.fn().mockResolvedValue([]) } as unknown as RulesStore;
    const logger = { warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
    const audit = { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditLogStore;
    const worker = new DeletionWorker(jobs, rules, settings, logger, 60_000, audit);
    vi.spyOn(worker, 'reconcileWebhook').mockResolvedValue(undefined);

    const starting = worker.start();
    await vi.waitFor(() => expect(jobs.claim).toHaveBeenCalledOnce());
    worker.pause();
    finishClaim([job]);
    await starting;
    worker.stop();

    expect(jobs.releaseClaim).toHaveBeenCalledWith('job-1');
    expect(settings.getEvolutionConnection).not.toHaveBeenCalled();
  });

  it('mantem como simulacao um job capturado em dry-run mesmo depois de desligar o modo', async () => {
    const simulatedJob = { ...job, simulateOnly: true };
    const jobs = {
      recoverExpiredLeases: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockResolvedValue([simulatedJob]),
      markSucceeded: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobsStore;
    const settings = {
      get: vi.fn().mockResolvedValue({ daemonEnabled: true, dryRun: false }),
      getEvolutionConnection: vi.fn(),
    } as unknown as SettingsStore;
    const rules = { list: vi.fn().mockResolvedValue([]) } as unknown as RulesStore;
    const logger = { warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
    const audit = { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditLogStore;
    const worker = new DeletionWorker(jobs, rules, settings, logger, 60_000, audit);
    vi.spyOn(worker, 'reconcileWebhook').mockResolvedValue(undefined);

    await worker.start();
    worker.stop();

    expect(jobs.markSucceeded).toHaveBeenCalledWith('job-1', true);
    expect(audit.write).toHaveBeenCalledWith(
      'info',
      'job.simulated',
      'Job processado em modo de simulacao.',
      expect.objectContaining({ jobId: 'job-1', messageType: 'text' }),
    );
    expect(rules.list).not.toHaveBeenCalled();
    expect(settings.getEvolutionConnection).not.toHaveBeenCalled();
  });

  it('honra um job de filtro textual sem persistir nem reconstruir o texto', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 201 })));
    const jobs = {
      recoverExpiredLeases: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockResolvedValueOnce([job]).mockResolvedValue([]),
      markSucceeded: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobsStore;
    const settings = {
      get: vi.fn().mockResolvedValue({ daemonEnabled: true, dryRun: false }),
      getEvolutionConnection: vi.fn().mockResolvedValue({
        baseUrl: 'http://evolution:8080',
        apiKey: 'secret-key',
        instanceName: 'personal',
      }),
    } as unknown as SettingsStore;
    const rules = { list: vi.fn().mockResolvedValue([textRule]) } as unknown as RulesStore;
    const logger = { warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
    const audit = { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditLogStore;
    const worker = new DeletionWorker(jobs, rules, settings, logger, 60_000, audit);
    vi.spyOn(worker, 'reconcileWebhook').mockResolvedValue(undefined);

    await worker.start();
    worker.stop();

    expect(jobs.markSucceeded).toHaveBeenCalledWith('job-1', false);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('cancela job legado criado sem uma regra explicita', async () => {
    const fallbackJob = { ...job, ruleId: null, ruleUpdatedAt: null };
    const jobs = {
      recoverExpiredLeases: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockResolvedValueOnce([fallbackJob]).mockResolvedValue([]),
      markCancelledByRule: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobsStore;
    const settings = {
      get: vi.fn().mockResolvedValue({ daemonEnabled: true, dryRun: false }),
      getEvolutionConnection: vi.fn(),
    } as unknown as SettingsStore;
    const rules = { list: vi.fn().mockResolvedValue([]) } as unknown as RulesStore;
    const logger = { warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
    const audit = { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditLogStore;
    const worker = new DeletionWorker(jobs, rules, settings, logger, 60_000, audit);
    vi.spyOn(worker, 'reconcileWebhook').mockResolvedValue(undefined);

    await worker.start();
    worker.stop();

    expect(jobs.markCancelledByRule).toHaveBeenCalledWith(
      'job-1',
      'nenhuma regra de exclusao explicita ativa',
    );
    expect(settings.getEvolutionConnection).not.toHaveBeenCalled();
  });
});
