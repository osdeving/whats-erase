import { Pool, type PoolClient, type QueryResultRow } from 'pg';

const migration = `
CREATE TABLE IF NOT EXISTS auth_credentials (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  evolution_base_url text NOT NULL,
  public_evolution_url text NOT NULL,
  evolution_api_key_encrypted text,
  instance_name text NOT NULL DEFAULT 'whats-erase',
  webhook_url text NOT NULL,
  webhook_secret_encrypted text,
  default_delay_seconds integer NOT NULL DEFAULT 7200 CHECK (default_delay_seconds BETWEEN 10 AND 604800),
  dry_run boolean NOT NULL DEFAULT true,
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  daemon_enabled boolean NOT NULL DEFAULT false,
  daemon_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rules (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN -10000 AND 10000),
  chat_kind text NOT NULL CHECK (chat_kind IN ('all', 'direct', 'group', 'exact')),
  chat_jid text,
  message_type text NOT NULL CHECK (message_type IN ('all', 'text', 'image', 'video', 'audio', 'document', 'sticker', 'other')),
  content_filter text NOT NULL DEFAULT 'any',
  content_pattern text,
  case_sensitive boolean NOT NULL DEFAULT false,
  action text NOT NULL CHECK (action IN ('delete', 'keep')),
  delay_seconds integer CHECK (delay_seconds BETWEEN 10 AND 604800),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((chat_kind = 'exact' AND chat_jid IS NOT NULL AND length(chat_jid) > 0) OR (chat_kind <> 'exact' AND chat_jid IS NULL)),
  CHECK ((action = 'delete' AND delay_seconds IS NOT NULL) OR (action = 'keep' AND delay_seconds IS NULL)),
  CONSTRAINT rules_content_filter_check CHECK (content_filter IN ('any', 'startsWith', 'notStartsWith', 'regex')),
  CONSTRAINT rules_content_pattern_check CHECK (
    (content_filter = 'any' AND content_pattern IS NULL)
    OR
    (content_filter <> 'any' AND content_pattern IS NOT NULL AND char_length(content_pattern) BETWEEN 1 AND 256)
  )
);

-- Regras criadas antes dos filtros de conteudo continuam equivalentes: qualquer
-- conteudo, sem distinguir maiusculas/minusculas. Mensagens nunca sao copiadas
-- para estas colunas; somente o criterio configurado pelo usuario e armazenado.
ALTER TABLE rules
  ADD COLUMN IF NOT EXISTS content_filter text NOT NULL DEFAULT 'any',
  ADD COLUMN IF NOT EXISTS content_pattern text,
  ADD COLUMN IF NOT EXISTS case_sensitive boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'rules'::regclass AND conname = 'rules_content_filter_check'
  ) THEN
    ALTER TABLE rules ADD CONSTRAINT rules_content_filter_check
      CHECK (content_filter IN ('any', 'startsWith', 'notStartsWith', 'regex'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'rules'::regclass AND conname = 'rules_content_pattern_check'
  ) THEN
    ALTER TABLE rules ADD CONSTRAINT rules_content_pattern_check CHECK (
      (content_filter = 'any' AND content_pattern IS NULL)
      OR
      (content_filter <> 'any' AND content_pattern IS NOT NULL AND char_length(content_pattern) BETWEEN 1 AND 256)
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS deletion_jobs (
  id uuid PRIMARY KEY,
  instance_name text NOT NULL,
  remote_jid text NOT NULL,
  participant text,
  message_id text NOT NULL,
  message_type text NOT NULL,
  sent_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  delete_at timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'retry', 'deleted', 'simulated', 'failed', 'cancelled', 'deleted_external')),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  lease_until timestamptz,
  rule_snapshot jsonb NOT NULL,
  is_test boolean NOT NULL DEFAULT false,
  simulate_only boolean NOT NULL DEFAULT true,
  last_error text,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_name, remote_jid, message_id)
);

-- Existing queued jobs predate the dry-run snapshot. Treating them as simulation-only
-- is the fail-safe migration: changing today's setting must never turn an old job into
-- a real deletion request.
ALTER TABLE deletion_jobs
  ADD COLUMN IF NOT EXISTS simulate_only boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS deletion_jobs_due_idx
  ON deletion_jobs (next_attempt_at, delete_at)
  WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS deletion_jobs_status_idx ON deletion_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS rules_match_idx ON rules (enabled, priority DESC);

CREATE TABLE IF NOT EXISTS operational_logs (
  id bigserial PRIMARY KEY,
  level text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  event text NOT NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_logs_created_idx
  ON operational_logs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS operational_logs_level_idx
  ON operational_logs (level, created_at DESC, id DESC);
`;

export class Database {
  readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  async initialize() {
    await this.pool.query(migration);
  }

  async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
    return this.pool.query<T>(text, values);
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}
