import type { Database } from '../db.js';

export type AuditLogLevel = 'info' | 'warn' | 'error';

interface AuditLogRow {
  id: string;
  level: AuditLogLevel;
  event: string;
  message: string;
  details: unknown;
  created_at: Date;
}

const JID_VALUE = /(?:^|\s)[^\s@]{2,}@(?:s\.whatsapp\.net|g\.us|lid|broadcast|newsletter)(?:\s|$)/i;
const TOKEN_VALUE = /(?:bearer\s+|eyJ[A-Za-z0-9_-]{8,}\.|apikey\s*[:=])/i;
const REDACTED = '[redacted]';

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    ['authorization', 'cookie', 'password', 'payload', 'body', 'content', 'media', 'text', 'jid', 'participant'].includes(
      normalized,
    ) ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('credential') ||
    normalized.endsWith('password') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('token') ||
    normalized.endsWith('payload') ||
    normalized.endsWith('body') ||
    normalized.endsWith('content') ||
    normalized.endsWith('media') ||
    normalized.endsWith('messagetext') ||
    normalized.endsWith('remotejid') ||
    normalized.endsWith('chatjid') ||
    normalized.endsWith('participant')
  );
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    if (JID_VALUE.test(value) || TOKEN_VALUE.test(value)) return REDACTED;
    return value.slice(0, 240);
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => sanitizeValue(entry, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 40)) {
      result[key.slice(0, 80)] = isSensitiveKey(key) ? REDACTED : sanitizeValue(entry, depth + 1);
    }
    return result;
  }
  return String(value).slice(0, 80);
}

export function sanitizeLogDetails(details: Record<string, unknown> = {}) {
  return sanitizeValue(details) as Record<string, unknown>;
}

function publicLog(row: AuditLogRow) {
  return {
    id: row.id,
    level: row.level,
    event: row.event,
    message: row.message,
    details: row.details,
    createdAt: row.created_at,
  };
}

export class AuditLogStore {
  constructor(
    private readonly db: Database,
    private readonly retention = 2_000,
  ) {}

  async write(level: AuditLogLevel, event: string, message: string, details: Record<string, unknown> = {}) {
    const safeEvent = event.toLowerCase().replace(/[^a-z0-9_.-]/g, '_').slice(0, 80) || 'unknown';
    const safeMessage = message.slice(0, 300);
    const safeDetails = sanitizeLogDetails(details);
    const result = await this.db.query<AuditLogRow>(
      `INSERT INTO operational_logs (level, event, message, details)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id::text, level, event, message, details, created_at`,
      [level, safeEvent, safeMessage, JSON.stringify(safeDetails)],
    );
    await this.prune();
    return publicLog(result.rows[0]!);
  }

  info(event: string, message: string, details?: Record<string, unknown>) {
    return this.write('info', event, message, details);
  }

  warn(event: string, message: string, details?: Record<string, unknown>) {
    return this.write('warn', event, message, details);
  }

  error(event: string, message: string, details?: Record<string, unknown>) {
    return this.write('error', event, message, details);
  }

  async list(level: AuditLogLevel | undefined, limit: number) {
    const values: unknown[] = [];
    let where = '';
    if (level) {
      values.push(level);
      where = `WHERE level = $${values.length}`;
    }
    values.push(limit);
    const result = await this.db.query<AuditLogRow>(
      `SELECT id::text, level, event, message, details, created_at
       FROM operational_logs ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(publicLog);
  }

  async prune() {
    await this.db.query(
      `DELETE FROM operational_logs
       WHERE id <= COALESCE(
         (SELECT id FROM operational_logs ORDER BY id DESC OFFSET $1 LIMIT 1),
         0
       )`,
      [this.retention],
    );
  }
}
