import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';

import { Database } from './db.js';
import type { Env } from './env.js';
import {
  createSessionToken,
  hashPassword,
  SecretBox,
  verifyPassword,
  verifySessionToken,
  verifyWebhookJwt,
} from './lib/crypto.js';
import {
  EvolutionClient,
  EvolutionError,
  extractConnectionState,
  extractQrCode,
} from './services/evolution-client.js';
import { AuditLogStore, type AuditLogLevel } from './services/audit-log-store.js';
import { JobsStore } from './services/jobs-store.js';
import { parseEvolutionDeletedKeys, parseEvolutionMessages } from './services/message-parser.js';
import { decideRule } from './services/rule-engine.js';
import { RulesStore, type RuleInput } from './services/rules-store.js';
import { SettingsStore } from './services/settings-store.js';
import { DeletionWorker } from './services/worker.js';

const SESSION_COOKIE = 'whats_erase_session';
const SESSION_MAX_AGE = 12 * 60 * 60;
const MAX_DELAY_SECONDS = 47 * 60 * 60;

const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Use uma URL HTTP ou HTTPS.');

const evolutionBaseUrlSchema = httpUrlSchema.refine((value) => {
  const parsed = new URL(value);
  return !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
}, 'Nao use credenciais, query string ou fragmento na URL da Evolution.');

const settingsSchema = z
  .object({
    evolutionBaseUrl: evolutionBaseUrlSchema.optional(),
    publicEvolutionUrl: z.union([httpUrlSchema, z.literal('')]).optional(),
    instanceName: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Use apenas letras, numeros, _ e -.').optional(),
    apiKey: z.string().trim().min(8).max(500).optional(),
    webhookUrl: httpUrlSchema.optional(),
    defaultDelaySeconds: z.number().int().min(10).max(MAX_DELAY_SECONDS).optional(),
    dryRun: z.boolean().optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
  })
  .strict();

const ruleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    priority: z.number().int().min(-10_000).max(10_000).default(0),
    chatKind: z.enum(['all', 'direct', 'group', 'exact']),
    chatJid: z.string().trim().max(200).nullable().optional(),
    messageType: z.enum(['all', 'text', 'image', 'video', 'audio', 'document', 'sticker', 'other']),
    action: z.enum(['delete', 'keep']),
    delaySeconds: z.number().int().min(10).max(MAX_DELAY_SECONDS).nullable().optional(),
    enabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.chatKind === 'exact' && !rule.chatJid) {
      context.addIssue({ code: 'custom', path: ['chatJid'], message: 'Informe o JID da conversa.' });
    }
    if (rule.action === 'delete' && rule.delaySeconds == null) {
      context.addIssue({ code: 'custom', path: ['delaySeconds'], message: 'Informe o atraso da exclusao.' });
    }
  });

const jobStatuses = [
  'pending',
  'processing',
  'retry',
  'deleted',
  'simulated',
  'failed',
  'cancelled',
  'deleted_external',
] as const;

interface AuthRow {
  password_hash: string;
  password_salt: string;
}

function isWhatsAppConnected(payload: unknown) {
  const state = extractConnectionState(payload);
  return { state, connected: state ? ['open', 'connected'].includes(state.toLowerCase()) : false };
}

function sessionSigningSecret(baseSecret: string, passwordHash: string) {
  return `${baseSecret}:${passwordHash}`;
}

async function ensureInstanceQr(client: EvolutionClient, webhookUrl: string, webhookSecret: string) {
  let response: unknown = null;
  let created = false;

  try {
    const currentStatus = isWhatsAppConnected(await client.connectionState());
    if (currentStatus.connected) return { qrCode: null, ...currentStatus, created };
  } catch (error) {
    if (!(error instanceof EvolutionError) || error.status !== 404) throw error;
    response = await client.createInstance(webhookUrl, webhookSecret);
    created = true;
  }

  if (response === null) response = await client.connect();
  let qrCode = extractQrCode(response);
  let status = isWhatsAppConnected(response);

  // Algumas builds criam a instancia antes de materializar o primeiro QR.
  // Uma chamada de connect logo em seguida cobre esse formato sem exigir outro clique.
  if (created && !qrCode && !status.connected) {
    response = await client.connect();
    qrCode = extractQrCode(response);
    status = isWhatsAppConnected(response);
  }

  if (!status.state) {
    try {
      status = isWhatsAppConnected(await client.connectionState());
    } catch {
      // O QR continua utilizavel enquanto a instancia passa para "connecting".
    }
  }
  return { qrCode, ...status, created };
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? value.slice(7) : undefined;
}

function evolutionWebhookEvent(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>).event;
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 80) : null;
}

function isPublicApi(path: string) {
  return (
    path === '/api/health' ||
    path === '/api/auth/status' ||
    path === '/api/auth/setup' ||
    path === '/api/auth/login' ||
    path === '/api/webhooks/evolution'
  );
}

export async function buildApp(env: Env) {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: env.LOG_LEVEL },
    bodyLimit: 512 * 1024,
  });
  await app.register(cookie);

  const db = new Database(env.DATABASE_URL);
  await db.initialize();
  const secretBox = new SecretBox(env.APP_ENCRYPTION_KEY);
  const settings = new SettingsStore(db, secretBox, env);
  await settings.initialize();
  const rules = new RulesStore(db);
  const jobs = new JobsStore(db);
  const audit = new AuditLogStore(db);
  const worker = new DeletionWorker(jobs, rules, settings, app.log, env.WORKER_POLL_MS, audit);

  const recordAudit = async (
    level: AuditLogLevel,
    event: string,
    message: string,
    details: Record<string, unknown> = {},
  ) => {
    try {
      await audit.write(level, event, message, details);
    } catch {
      app.log.warn({ event }, 'Falha ao persistir log operacional');
    }
  };

  app.decorate('services', { db, settings, rules, jobs, audit, worker });

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] ?? request.url;
    if (!path.startsWith('/api/') || isPublicApi(path)) return;
    const credentials = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM auth_credentials WHERE id = 1',
    );
    const passwordHash = credentials.rows[0]?.password_hash;
    if (
      !passwordHash ||
      !verifySessionToken(request.cookies[SESSION_COOKIE], sessionSigningSecret(env.SESSION_SECRET, passwordHash))
    ) {
      return reply.code(401).send({ error: 'AUTH_REQUIRED', message: 'Entre novamente para continuar.' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin) {
        try {
          if (new URL(origin).host !== request.headers.host) {
            return reply.code(403).send({ error: 'INVALID_ORIGIN', message: 'Origem da requisicao recusada.' });
          }
        } catch {
          return reply.code(403).send({ error: 'INVALID_ORIGIN', message: 'Origem da requisicao recusada.' });
        }
      }
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    return payload;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Revise os campos informados.',
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    if (error instanceof EvolutionError) {
      return reply.code(error.status && error.status >= 400 && error.status < 600 ? error.status : 502).send({
        error: error.code,
        message: error.message,
      });
    }
    app.log.error({ err: error }, 'Erro nao tratado');
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Ocorreu um erro interno.' });
  });

  app.get('/api/health', async (_request, reply) => {
    await db.query('SELECT 1');
    return reply.send({ ok: true });
  });

  app.get('/api/auth/status', async (request) => {
    const result = await db.query<{ password_hash: string }>('SELECT password_hash FROM auth_credentials WHERE id = 1');
    const passwordHash = result.rows[0]?.password_hash;
    const needsSetup = !passwordHash;
    return {
      needsSetup,
      authenticated:
        !needsSetup &&
        verifySessionToken(request.cookies[SESSION_COOKIE], sessionSigningSecret(env.SESSION_SECRET, passwordHash)),
    };
  });

  app.post('/api/auth/setup', async (request, reply) => {
    const input = z.object({ password: z.string().min(10).max(200) }).strict().parse(request.body);
    const existing = await db.query('SELECT 1 FROM auth_credentials WHERE id = 1');
    if ((existing.rowCount ?? 0) > 0) {
      return reply.code(409).send({ error: 'ALREADY_CONFIGURED', message: 'A senha inicial ja foi configurada.' });
    }
    const password = await hashPassword(input.password);
    try {
      await db.query('INSERT INTO auth_credentials (id, password_hash, password_salt) VALUES (1, $1, $2)', [
        password.hash,
        password.salt,
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'ALREADY_CONFIGURED', message: 'A senha inicial ja foi configurada.' });
      }
      throw error;
    }
    reply.setCookie(
      SESSION_COOKIE,
      createSessionToken(sessionSigningSecret(env.SESSION_SECRET, password.hash), SESSION_MAX_AGE),
      {
        httpOnly: true,
        sameSite: 'strict',
        secure: false,
        path: '/',
        maxAge: SESSION_MAX_AGE,
      },
    );
    return reply.code(201).send({ authenticated: true });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = z.object({ password: z.string().min(1).max(200) }).strict().parse(request.body);
    const result = await db.query<AuthRow>('SELECT password_hash, password_salt FROM auth_credentials WHERE id = 1');
    const credentials = result.rows[0];
    const valid = credentials && (await verifyPassword(input.password, credentials.password_salt, credentials.password_hash));
    if (!valid) return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Senha incorreta.' });
    reply.setCookie(
      SESSION_COOKIE,
      createSessionToken(sessionSigningSecret(env.SESSION_SECRET, credentials.password_hash), SESSION_MAX_AGE),
      {
        httpOnly: true,
        sameSite: 'strict',
        secure: false,
        path: '/',
        maxAge: SESSION_MAX_AGE,
      },
    );
    return reply.send({ authenticated: true });
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ authenticated: false });
  });

  app.get('/api/settings', async () => settings.getPublic());

  app.put('/api/settings', async (request) => {
    const input = settingsSchema.parse(request.body);
    const updated = await settings.update(input);
    await recordAudit('info', 'settings.updated', 'Configuracoes operacionais atualizadas.', {
      instanceName: updated.instanceName,
      defaultDelaySeconds: updated.defaultDelaySeconds,
      dryRun: updated.dryRun,
      maxAttempts: updated.maxAttempts,
      apiKeyChanged: input.apiKey !== undefined,
    });
    return updated;
  });

  app.post('/api/evolution/test', async (_request, reply) => {
    const connection = await settings.getEvolutionConnection();
    const client = new EvolutionClient(connection);
    const server = (await client.serverInfo()) as Record<string, unknown>;
    let credentialsValid = false;
    let connectionState: unknown = null;
    try {
      await client.verifyCredentials();
      credentialsValid = true;
    } catch (error) {
      if (!(error instanceof EvolutionError) || ![401, 403].includes(error.status ?? 0)) throw error;
      try {
        connectionState = await client.connectionState();
        credentialsValid = true;
      } catch {
        credentialsValid = false;
      }
    }
    if (connectionState === null && credentialsValid) {
      try {
        connectionState = await client.connectionState();
      } catch (error) {
        if (!(error instanceof EvolutionError) || error.status !== 404) throw error;
      }
    }
    if (!credentialsValid) {
      await recordAudit('warn', 'evolution.test_rejected', 'Teste de conexao rejeitado pela Evolution.', {
        credentialsValid: false,
        version: typeof server.version === 'string' ? server.version : null,
      });
      return reply.code(401).send({
        error: 'EVOLUTION_AUTH_FAILED',
        message: 'A Evolution API rejeitou a chave informada.',
        reachable: true,
        credentialsValid: false,
        version: server.version ?? null,
      });
    }
    await recordAudit('info', 'evolution.test_succeeded', 'Conexao com a Evolution validada.', {
      credentialsValid,
      version: typeof server.version === 'string' ? server.version : null,
      connectionState: extractConnectionState(connectionState),
    });
    return { reachable: true, credentialsValid, version: server.version ?? null, connection: connectionState };
  });

  app.post('/api/evolution/instance', async (request) => {
    const input = z
      .object({ instanceName: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/) })
      .strict()
      .parse(request.body);
    await settings.update({ instanceName: input.instanceName });
    const connection = await settings.getEvolutionConnection();
    const current = await settings.get();
    const client = new EvolutionClient(connection);
    const result = await ensureInstanceQr(client, current.webhookUrl, await settings.getWebhookSecret());
    return { instanceName: input.instanceName, ...result };
  });

  app.get('/api/evolution/qr', async () => {
    const connection = await settings.getEvolutionConnection();
    const client = new EvolutionClient(connection);
    const current = await settings.get();
    return ensureInstanceQr(client, current.webhookUrl, await settings.getWebhookSecret());
  });

  app.get('/api/status', async () => {
    const current = await settings.get();
    const counts = await jobs.counts();
    let evolution: Record<string, unknown> = { reachable: false, connection: null };
    try {
      const connection = await settings.getEvolutionConnection();
      const client = new EvolutionClient(connection);
      const server = (await client.serverInfo()) as Record<string, unknown>;
      let state: unknown = null;
      try {
        state = await client.connectionState();
      } catch {
        // A API esta acessivel, mas a instancia pode ainda nao existir.
      }
      evolution = { reachable: true, version: server.version ?? null, connection: state };
    } catch (error) {
      evolution = { reachable: false, connection: null, error: error instanceof Error ? error.message : 'Indisponivel' };
    }
    return {
      daemonEnabled: current.daemonEnabled,
      daemonStartedAt: current.daemonStartedAt,
      dryRun: current.dryRun,
      evolution,
      worker: worker.status(),
      counts,
    };
  });

  app.post('/api/daemon/start', async (_request, reply) => {
    try {
      const current = await settings.get();
      const connection = await settings.getEvolutionConnection();
      const client = new EvolutionClient(connection);
      await client.serverInfo();
      const connectionStatus = isWhatsAppConnected(await client.connectionState());
      if (!connectionStatus.connected) {
        await recordAudit('warn', 'daemon.start_rejected', 'Inicio recusado porque o WhatsApp nao esta conectado.', {
          connectionState: connectionStatus.state,
        });
        return reply.code(409).send({
          error: 'WHATSAPP_NOT_CONNECTED',
          message: 'Conecte o WhatsApp pelo QR Code antes de iniciar o daemon.',
          state: connectionStatus.state,
        });
      }
      await client.configureWebhook(current.webhookUrl, await settings.getWebhookSecret());
      const started = await settings.startDaemon();
      worker.resume();
      void worker.tick();
      await recordAudit('info', 'daemon.started', 'Daemon iniciado.', {
        dryRun: started.dryRun,
        startedAt: started.daemonStartedAt,
      });
      return reply.send({ daemonEnabled: true, daemonStartedAt: started.daemonStartedAt, dryRun: started.dryRun });
    } catch (error) {
      await recordAudit('error', 'daemon.start_failed', 'Falha ao iniciar o daemon.', {
        errorCode: error instanceof EvolutionError ? error.code : 'DAEMON_START_ERROR',
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
  });

  app.post('/api/daemon/stop', async () => {
    worker.pause();
    await settings.stopDaemon();
    await recordAudit('info', 'daemon.stopped', 'Daemon parado; jobs pendentes foram preservados.');
    return { daemonEnabled: false, pendingJobsPreserved: true };
  });

  app.get('/api/rules', async () => rules.list());

  app.post('/api/rules', async (request, reply) => {
    const input = ruleSchema.parse(request.body) as RuleInput;
    const created = await rules.create(input);
    await recordAudit('info', 'rule.created', 'Regra criada.', {
      ruleId: created.id,
      action: created.action,
      chatKind: created.chatKind,
      messageType: created.messageType,
      delaySeconds: created.delaySeconds,
    });
    return reply.code(201).send(created);
  });

  app.put<{ Params: { id: string } }>('/api/rules/:id', async (request, reply) => {
    const id = z.string().uuid().parse(request.params.id);
    const input = ruleSchema.parse(request.body) as RuleInput;
    const updated = await rules.update(id, input);
    if (updated) {
      await recordAudit('info', 'rule.updated', 'Regra atualizada.', {
        ruleId: updated.id,
        action: updated.action,
        chatKind: updated.chatKind,
        messageType: updated.messageType,
        delaySeconds: updated.delaySeconds,
      });
    }
    return updated ?? reply.code(404).send({ error: 'NOT_FOUND', message: 'Regra nao encontrada.' });
  });

  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (request, reply) => {
    const id = z.string().uuid().parse(request.params.id);
    if (!(await rules.remove(id))) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Regra nao encontrada.' });
    }
    await recordAudit('warn', 'rule.deleted', 'Regra excluida.', { ruleId: id });
    return reply.code(204).send();
  });

  app.get('/api/jobs', async (request) => {
    const query = z
      .object({ status: z.enum(jobStatuses).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(request.query);
    return jobs.list(query.status, query.limit);
  });

  app.get('/api/logs', async (request) => {
    const query = z
      .object({
        level: z.enum(['info', 'warn', 'error']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .strict()
      .parse(request.query);
    return audit.list(query.level, query.limit);
  });

  app.post<{ Params: { id: string } }>('/api/jobs/:id/retry', async (request, reply) => {
    const job = await jobs.retry(z.string().uuid().parse(request.params.id));
    if (!job) return reply.code(409).send({ error: 'INVALID_STATE', message: 'Esse job nao pode ser repetido.' });
    await recordAudit('info', 'job.retry_requested', 'Nova tentativa solicitada manualmente.', {
      jobId: request.params.id,
    });
    void worker.tick();
    return job;
  });

  app.post<{ Params: { id: string } }>('/api/jobs/:id/cancel', async (request, reply) => {
    const job = await jobs.cancel(z.string().uuid().parse(request.params.id));
    if (job) {
      await recordAudit('warn', 'job.cancelled', 'Job cancelado manualmente.', { jobId: request.params.id });
    }
    return job ?? reply.code(409).send({ error: 'INVALID_STATE', message: 'Esse job nao pode ser cancelado.' });
  });

  app.post('/api/jobs/test', async (_request, reply) => {
    const current = await settings.get();
    if (!current.daemonEnabled) {
      return reply.code(409).send({ error: 'DAEMON_STOPPED', message: 'Inicie o daemon antes de testar a fila.' });
    }
    const job = await jobs.createTestJob(current.instanceName, current.maxAttempts);
    await recordAudit('info', 'job.scheduled', 'Job seguro de teste adicionado a fila.', {
      jobId: job.id,
      isTest: true,
      simulateOnly: true,
    });
    void worker.tick();
    return reply.code(201).send(job);
  });

  app.post('/api/webhooks/evolution', async (request, reply) => {
    const secret = await settings.getWebhookSecret();
    if (!verifyWebhookJwt(bearerToken(request), secret)) {
      await recordAudit('warn', 'webhook.rejected', 'Webhook recusado por autenticacao invalida.');
      return reply.code(401).send({ accepted: false });
    }
    const current = await settings.get();
    const webhookEvent = evolutionWebhookEvent(request.body);
    const deletedKeys = parseEvolutionDeletedKeys(request.body);
    let matchedDeleteEvents = 0;
    for (const key of deletedKeys) {
      matchedDeleteEvents += await jobs.recordDeleteEvent(key.instance, key.remoteJid, key.messageId);
    }
    if (deletedKeys.length > 0) {
      await recordAudit('info', 'job.delete_event_received', 'Evento de revogacao recebido pela sessao conectada.', {
        received: deletedKeys.length,
        matchedJobs: matchedDeleteEvents,
        confirmsEveryDevice: false,
        webhookEvent,
      });
    }
    if (!current.daemonEnabled || !current.daemonStartedAt) {
      await recordAudit('info', 'webhook.ignored', 'Webhook aceito, mas ignorado porque o daemon esta parado.', {
        matchedDeleteEvents,
        webhookEvent,
        reason: 'daemon_stopped',
      });
      return reply.send({ accepted: true, scheduled: 0, ignored: 'daemon_stopped', markedExternal: matchedDeleteEvents });
    }
    let scheduled = 0;
    let ignored = 0;
    const activeRules = await rules.list();
    const messages = parseEvolutionMessages(request.body);
    for (const message of messages) {
      if (message.instance !== current.instanceName || message.sentAt.getTime() < current.daemonStartedAt.getTime() - 5_000) {
        ignored += 1;
        continue;
      }
      const decision = decideRule(message, activeRules, current.defaultDelaySeconds);
      if (decision.action === 'keep') {
        ignored += 1;
        continue;
      }
      const result = await jobs.schedule(message, decision, current.maxAttempts, current.dryRun);
      if (result.inserted) {
        scheduled += 1;
        await recordAudit('info', 'job.scheduled', 'Mensagem enviada adicionada a fila de exclusao.', {
          jobId: result.id,
          messageType: message.messageType,
          deleteAt: new Date(message.sentAt.getTime() + (decision.delaySeconds ?? 0) * 1_000),
          simulateOnly: current.dryRun,
          ruleId: decision.ruleId,
        });
      } else {
        ignored += 1;
      }
    }
    await recordAudit('info', scheduled > 0 ? 'webhook.scheduled' : 'webhook.accepted', scheduled > 0
      ? 'Webhook aceito e mensagens agendadas.'
      : 'Webhook aceito sem novas mensagens para agendar.', {
      received: messages.length,
      scheduled,
      ignored,
      matchedDeleteEvents,
      webhookEvent,
    });
    return reply.send({ accepted: true, scheduled, ignored, markedExternal: matchedDeleteEvents });
  });

  const staticRoot = resolve(process.cwd(), 'apps/web/dist');
  if (existsSync(staticRoot)) {
    await app.register(fastifyStatic, { root: staticRoot, wildcard: false });
  }
  app.setNotFoundHandler((request, reply) => {
    if (!request.url.startsWith('/api/') && existsSync(resolve(staticRoot, 'index.html'))) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'NOT_FOUND', message: 'Rota nao encontrada.' });
  });

  app.addHook('onClose', async () => {
    worker.stop();
    await db.close();
  });

  await worker.start();
  const startupSettings = await settings.get();
  await recordAudit('info', 'app.started', 'WhatsErase iniciado e worker pronto.', {
    daemonEnabled: startupSettings.daemonEnabled,
    dryRun: startupSettings.dryRun,
  });
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: {
      db: Database;
      settings: SettingsStore;
      rules: RulesStore;
      jobs: JobsStore;
      audit: AuditLogStore;
      worker: DeletionWorker;
    };
  }
}
