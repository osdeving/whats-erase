import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { ClaimedJob } from '../src/types.js';
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
};

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
});
