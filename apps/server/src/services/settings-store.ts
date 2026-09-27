import { randomBytes } from 'node:crypto';

import type { Database } from '../db.js';
import type { Env } from '../env.js';
import { SecretBox } from '../lib/crypto.js';
import type { AppSettings } from '../types.js';

interface SettingsRow {
  evolution_base_url: string;
  public_evolution_url: string;
  evolution_api_key_encrypted: string | null;
  instance_name: string;
  webhook_url: string;
  webhook_secret_encrypted: string | null;
  default_delay_seconds: number;
  dry_run: boolean;
  max_attempts: number;
  daemon_enabled: boolean;
  daemon_started_at: Date | null;
}

export interface PublicSettings {
  evolutionBaseUrl: string;
  publicEvolutionUrl: string;
  instanceName: string;
  apiKeyConfigured: boolean;
  webhookUrl: string;
  defaultDelaySeconds: number;
  dryRun: boolean;
  maxAttempts: number;
}

export interface SettingsUpdate {
  evolutionBaseUrl?: string;
  publicEvolutionUrl?: string;
  instanceName?: string;
  apiKey?: string;
  webhookUrl?: string;
  defaultDelaySeconds?: number;
  dryRun?: boolean;
  maxAttempts?: number;
}

export class SettingsStore {
  constructor(
    private readonly db: Database,
    private readonly secretBox: SecretBox,
    private readonly env: Env,
  ) {}

  async initialize() {
    await this.db.query(
      `INSERT INTO app_settings (
        id, evolution_base_url, public_evolution_url, instance_name, webhook_url
      ) VALUES (1, $1, $2, 'whats-erase', $3)
      ON CONFLICT (id) DO NOTHING`,
      [this.env.BUNDLED_EVOLUTION_URL.replace(/\/$/, ''), this.env.PUBLIC_EVOLUTION_URL.replace(/\/$/, ''), this.env.WEBHOOK_URL],
    );

    const current = await this.get();
    const updates: string[] = [];
    const values: unknown[] = [];
    if (!current.webhookSecretEncrypted) {
      values.push(this.secretBox.encrypt(randomBytes(32).toString('base64url')));
      updates.push(`webhook_secret_encrypted = $${values.length}`);
    }
    if (!current.evolutionApiKeyEncrypted && this.env.BUNDLED_EVOLUTION_API_KEY) {
      values.push(this.secretBox.encrypt(this.env.BUNDLED_EVOLUTION_API_KEY));
      updates.push(`evolution_api_key_encrypted = $${values.length}`);
    }
    if (updates.length > 0) {
      await this.db.query(`UPDATE app_settings SET ${updates.join(', ')}, updated_at = now() WHERE id = 1`, values);
    }
  }

  async get(): Promise<AppSettings> {
    const result = await this.db.query<SettingsRow>('SELECT * FROM app_settings WHERE id = 1');
    const row = result.rows[0];
    if (!row) throw new Error('Configuracao nao inicializada.');
    return {
      evolutionBaseUrl: row.evolution_base_url,
      publicEvolutionUrl: row.public_evolution_url,
      evolutionApiKeyEncrypted: row.evolution_api_key_encrypted,
      instanceName: row.instance_name,
      webhookUrl: row.webhook_url,
      webhookSecretEncrypted: row.webhook_secret_encrypted ?? '',
      defaultDelaySeconds: row.default_delay_seconds,
      dryRun: row.dry_run,
      maxAttempts: row.max_attempts,
      daemonEnabled: row.daemon_enabled,
      daemonStartedAt: row.daemon_started_at,
    };
  }

  async getPublic(): Promise<PublicSettings> {
    const settings = await this.get();
    return {
      evolutionBaseUrl: settings.evolutionBaseUrl,
      publicEvolutionUrl: settings.publicEvolutionUrl,
      instanceName: settings.instanceName,
      apiKeyConfigured: Boolean(settings.evolutionApiKeyEncrypted),
      webhookUrl: settings.webhookUrl,
      defaultDelaySeconds: settings.defaultDelaySeconds,
      dryRun: settings.dryRun,
      maxAttempts: settings.maxAttempts,
    };
  }

  async update(input: SettingsUpdate): Promise<PublicSettings> {
    const fields: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };

    if (input.evolutionBaseUrl !== undefined) set('evolution_base_url', input.evolutionBaseUrl.replace(/\/$/, ''));
    if (input.publicEvolutionUrl !== undefined) set('public_evolution_url', input.publicEvolutionUrl.replace(/\/$/, ''));
    if (input.instanceName !== undefined) set('instance_name', input.instanceName.trim());
    if (input.apiKey !== undefined && input.apiKey.length > 0) set('evolution_api_key_encrypted', this.secretBox.encrypt(input.apiKey));
    if (input.webhookUrl !== undefined) set('webhook_url', input.webhookUrl.replace(/\/$/, ''));
    if (input.defaultDelaySeconds !== undefined) set('default_delay_seconds', input.defaultDelaySeconds);
    if (input.dryRun !== undefined) set('dry_run', input.dryRun);
    if (input.maxAttempts !== undefined) set('max_attempts', input.maxAttempts);

    if (fields.length > 0) {
      await this.db.query(`UPDATE app_settings SET ${fields.join(', ')}, updated_at = now() WHERE id = 1`, values);
    }
    return this.getPublic();
  }

  async getEvolutionConnection() {
    const settings = await this.get();
    if (!settings.evolutionApiKeyEncrypted) throw new Error('A API key da Evolution ainda nao foi configurada.');
    return {
      baseUrl: settings.evolutionBaseUrl,
      apiKey: this.secretBox.decrypt(settings.evolutionApiKeyEncrypted),
      instanceName: settings.instanceName,
    };
  }

  async getWebhookSecret() {
    const settings = await this.get();
    if (!settings.webhookSecretEncrypted) throw new Error('Segredo do webhook ausente.');
    return this.secretBox.decrypt(settings.webhookSecretEncrypted);
  }

  async startDaemon() {
    await this.db.query(
      `UPDATE app_settings
       SET daemon_enabled = true, daemon_started_at = now(), updated_at = now()
       WHERE id = 1`,
    );
    return this.get();
  }

  async stopDaemon() {
    await this.db.query('UPDATE app_settings SET daemon_enabled = false, updated_at = now() WHERE id = 1');
    return this.get();
  }
}
