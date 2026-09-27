import { randomUUID } from 'node:crypto';

import type { Database } from '../db.js';
import type { ClaimedJob, JobStatus, ParsedMessage, RuleDecision } from '../types.js';

interface JobRow {
  id: string;
  instance_name: string;
  remote_jid: string;
  participant: string | null;
  message_id: string;
  message_type: string;
  sent_at: Date;
  received_at: Date;
  delete_at: Date;
  next_attempt_at: Date;
  status: JobStatus;
  attempt_count: number;
  max_attempts: number;
  rule_snapshot: unknown;
  is_test: boolean;
  simulate_only: boolean;
  last_error: string | null;
  last_error_code: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function scheduledRule(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { ruleId: null, ruleUpdatedAt: null };
  }
  const value = snapshot as Record<string, unknown>;
  return {
    ruleId: typeof value.ruleId === 'string' ? value.ruleId : null,
    ruleUpdatedAt: typeof value.ruleUpdatedAt === 'string' ? value.ruleUpdatedAt : null,
  };
}

function publicJob(row: JobRow) {
  return {
    id: row.id,
    instanceName: row.instance_name,
    remoteJid: row.remote_jid,
    participant: row.participant,
    messageId: row.message_id,
    messageType: row.message_type,
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    deleteAt: row.delete_at,
    nextAttemptAt: row.next_attempt_at,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    ruleSnapshot: row.rule_snapshot,
    isTest: row.is_test,
    simulateOnly: row.simulate_only,
    lastError: row.last_error,
    lastErrorCode: row.last_error_code,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class JobsStore {
  constructor(private readonly db: Database) {}

  async schedule(message: ParsedMessage, decision: RuleDecision, maxAttempts: number, simulateOnly: boolean) {
    if (decision.action !== 'delete' || decision.delaySeconds === null) return { inserted: false, id: null };
    const id = randomUUID();
    const deleteAt = new Date(message.sentAt.getTime() + decision.delaySeconds * 1000);
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO deletion_jobs (
        id, instance_name, remote_jid, participant, message_id, message_type, sent_at,
        delete_at, next_attempt_at, status, max_attempts, rule_snapshot, simulate_only
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, 'pending', $9, $10::jsonb, $11)
      ON CONFLICT (instance_name, remote_jid, message_id) DO NOTHING
      RETURNING id`,
      [
        id,
        message.instance,
        message.remoteJid,
        message.participant,
        message.messageId,
        message.messageType,
        message.sentAt,
        deleteAt,
        maxAttempts,
        JSON.stringify(decision),
        simulateOnly,
      ],
    );
    return { inserted: result.rowCount === 1, id: result.rows[0]?.id ?? null };
  }

  async createTestJob(instanceName: string, maxAttempts: number) {
    const id = randomUUID();
    const messageId = `TEST-${randomUUID()}`;
    const result = await this.db.query<JobRow>(
      `INSERT INTO deletion_jobs (
         id, instance_name, remote_jid, message_id, message_type, sent_at, delete_at,
         next_attempt_at, status, max_attempts, rule_snapshot, is_test, simulate_only
       ) VALUES ($1, $2, 'teste@s.whatsapp.net', $3, 'text', now(), now(), now(), 'pending', $4,
         '{"ruleName":"Teste seguro do pipeline","action":"delete","delaySeconds":0}'::jsonb, true, true)
       RETURNING *`,
      [id, instanceName, messageId, maxAttempts],
    );
    return publicJob(result.rows[0]!);
  }

  async list(status: string | undefined, limit: number) {
    const values: unknown[] = [];
    let where = '';
    if (status) {
      values.push(status);
      where = `WHERE status = $${values.length}`;
    }
    values.push(limit);
    const result = await this.db.query<JobRow>(
      `SELECT * FROM deletion_jobs ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(publicJob);
  }

  async counts() {
    const result = await this.db.query<{ status: JobStatus; count: string }>(
      'SELECT status, count(*)::text AS count FROM deletion_jobs GROUP BY status',
    );
    return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.count)]));
  }

  async cancel(id: string) {
    const result = await this.db.query<JobRow>(
      `UPDATE deletion_jobs
       SET status = 'cancelled', completed_at = now(), lease_until = NULL, updated_at = now()
       WHERE id = $1 AND status IN ('pending', 'retry')
       RETURNING *`,
      [id],
    );
    return result.rows[0] ? publicJob(result.rows[0]) : null;
  }

  async retry(id: string) {
    const result = await this.db.query<JobRow>(
      `UPDATE deletion_jobs
       SET status = 'retry', next_attempt_at = now(), lease_until = NULL, completed_at = NULL,
           last_error = NULL, last_error_code = NULL, updated_at = now()
       WHERE id = $1 AND status IN ('failed', 'cancelled')
       RETURNING *`,
      [id],
    );
    return result.rows[0] ? publicJob(result.rows[0]) : null;
  }

  async recordDeleteEvent(instance: string, remoteJid: string, messageId: string) {
    const result = await this.db.query(
      `UPDATE deletion_jobs
       SET status = CASE
             WHEN status IN ('pending', 'retry', 'processing') THEN 'deleted_external'
             ELSE status
           END,
           completed_at = COALESCE(completed_at, now()), lease_until = NULL, updated_at = now()
       WHERE instance_name = $1 AND remote_jid = $2 AND message_id = $3
         AND status IN ('pending', 'retry', 'processing', 'deleted', 'deleted_external')`,
      [instance, remoteJid, messageId],
    );
    return result.rowCount ?? 0;
  }

  async recoverExpiredLeases() {
    await this.db.query(
      `UPDATE deletion_jobs
       SET status = 'retry', next_attempt_at = now(), lease_until = NULL,
           last_error = 'Worker reiniciado durante a tentativa anterior', last_error_code = 'LEASE_EXPIRED', updated_at = now()
       WHERE status = 'processing' AND lease_until < now()`,
    );
  }

  async releaseClaim(id: string) {
    await this.db.query(
      `UPDATE deletion_jobs
       SET status = 'retry', next_attempt_at = GREATEST(delete_at, now()), lease_until = NULL,
           attempt_count = GREATEST(0, attempt_count - 1), updated_at = now()
       WHERE id = $1 AND status = 'processing'`,
      [id],
    );
  }

  async claim(limit = 10): Promise<ClaimedJob[]> {
    const result = await this.db.query<{
      id: string;
      instance_name: string;
      remote_jid: string;
      participant: string | null;
      message_id: string;
      message_type: string;
      sent_at: Date;
      delete_at: Date;
      attempt_count: number;
      max_attempts: number;
      is_test: boolean;
      simulate_only: boolean;
      rule_snapshot: unknown;
    }>(
      `WITH picked AS (
        SELECT j.id
        FROM deletion_jobs j
        CROSS JOIN app_settings s
        WHERE s.id = 1 AND s.daemon_enabled = true
          AND j.status IN ('pending', 'retry')
          AND j.delete_at <= now() AND j.next_attempt_at <= now()
        ORDER BY j.next_attempt_at ASC, j.created_at ASC
        LIMIT $1
        FOR UPDATE OF j SKIP LOCKED
      )
      UPDATE deletion_jobs j
      SET status = 'processing', attempt_count = j.attempt_count + 1,
          lease_until = now() + interval '60 seconds', updated_at = now()
      FROM picked
      WHERE j.id = picked.id
      RETURNING j.id, j.instance_name, j.remote_jid, j.participant, j.message_id, j.message_type,
                j.sent_at, j.delete_at, j.attempt_count, j.max_attempts, j.is_test, j.simulate_only,
                j.rule_snapshot`,
      [limit],
    );
    return result.rows.map((row) => {
      const snapshot = scheduledRule(row.rule_snapshot);
      return {
        id: row.id,
        instanceName: row.instance_name,
        remoteJid: row.remote_jid,
        participant: row.participant,
        messageId: row.message_id,
        messageType: row.message_type as ClaimedJob['messageType'],
        sentAt: row.sent_at,
        deleteAt: row.delete_at,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        isTest: row.is_test,
        simulateOnly: row.simulate_only,
        ...snapshot,
      };
    });
  }

  async markSucceeded(id: string, simulated: boolean) {
    await this.db.query(
      `UPDATE deletion_jobs
       SET status = $2, completed_at = now(), lease_until = NULL, last_error = NULL,
           last_error_code = NULL, updated_at = now()
       WHERE id = $1 AND status = 'processing'`,
      [id, simulated ? 'simulated' : 'deleted'],
    );
  }

  async markCancelledByRule(id: string, ruleName: string) {
    await this.db.query(
      `UPDATE deletion_jobs
       SET status = 'cancelled', completed_at = now(), lease_until = NULL,
           last_error = $2, last_error_code = 'PROTECTED_BY_RULE', updated_at = now()
       WHERE id = $1 AND status = 'processing'`,
      [id, `Protegida pela regra atual: ${ruleName}`],
    );
  }

  async markFailure(job: ClaimedJob, code: string, message: string, permanent: boolean) {
    const exhausted = job.attemptCount >= job.maxAttempts;
    if (permanent || exhausted) {
      await this.db.query(
        `UPDATE deletion_jobs
         SET status = 'failed', completed_at = now(), lease_until = NULL,
             last_error = $2, last_error_code = $3, updated_at = now()
         WHERE id = $1 AND status = 'processing'`,
        [job.id, message, code],
      );
      return;
    }
    const baseSeconds = Math.min(15 * 60, 5 * 2 ** Math.max(0, job.attemptCount - 1));
    const jitterSeconds = Math.floor(Math.random() * Math.max(1, Math.floor(baseSeconds / 4)));
    await this.db.query(
      `UPDATE deletion_jobs
       SET status = 'retry', next_attempt_at = now() + ($2 * interval '1 second'), lease_until = NULL,
           last_error = $3, last_error_code = $4, updated_at = now()
       WHERE id = $1 AND status = 'processing'`,
      [job.id, baseSeconds + jitterSeconds, message, code],
    );
  }
}
