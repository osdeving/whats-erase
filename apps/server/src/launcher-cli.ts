import { rename, writeFile } from 'node:fs/promises';

import { Database } from './db.js';
import { loadEnv } from './env.js';
import { SecretBox } from './lib/crypto.js';
import { AuditLogStore } from './services/audit-log-store.js';
import {
  EvolutionClient,
  EvolutionError,
  extractConnectionState,
  extractQrCode,
} from './services/evolution-client.js';
import { SettingsStore } from './services/settings-store.js';

type LauncherCode =
  | 'READY'
  | 'STATUS'
  | 'QR_REQUIRED'
  | 'QR_PENDING'
  | 'INSTANCE_MISSING'
  | 'SETUP_REQUIRED'
  | 'DAEMON_STOPPED'
  | 'EVOLUTION_UNAVAILABLE'
  | 'LAUNCHER_ERROR';

interface LauncherResult {
  schemaVersion: 1;
  ok: boolean;
  code: LauncherCode;
  connected: boolean;
  state: string | null;
  daemonEnabled: boolean;
  setupRequired: boolean;
  qrReady: boolean;
  restartRequired: boolean;
  retryAfterMs: number;
  panelUrl: string;
  message: string;
}

const command = process.argv[2] ?? 'status';
const qrOutput = process.argv[3] ?? '';
const panelUrl = process.env.LAUNCHER_PANEL_URL ?? 'http://localhost:3210';

function send(result: Omit<LauncherResult, 'schemaVersion' | 'panelUrl'>) {
  process.stdout.write(JSON.stringify({ schemaVersion: 1, panelUrl, ...result } satisfies LauncherResult));
}

function isConnected(payload: unknown) {
  const state = extractConnectionState(payload);
  return { state, connected: state ? ['open', 'connected'].includes(state.toLowerCase()) : false };
}

function validQrPath(value: string) {
  return /^\/tmp\/whats-erase-qr-[a-zA-Z0-9-]+\.png$/.test(value);
}

function qrPng(payload: unknown) {
  const value = extractQrCode(payload);
  if (!value) return null;
  const match = /^data:image\/png;base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(value);
  const encoded = (match?.[1] ?? value).replace(/\s/g, '');
  if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) return null;
  const data = Buffer.from(encoded, 'base64');
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (data.length < 100 || data.length > 2 * 1024 * 1024 || !data.subarray(0, 8).equals(pngMagic)) return null;
  return data;
}

async function persistQr(payload: unknown) {
  if (!qrOutput || !validQrPath(qrOutput)) return false;
  const data = qrPng(payload);
  if (!data) return false;
  const temporary = `${qrOutput}.tmp`;
  await writeFile(temporary, data, { mode: 0o600 });
  await rename(temporary, qrOutput);
  return true;
}

function friendlyError(error: unknown): Pick<LauncherResult, 'code' | 'message' | 'setupRequired'> {
  if (error instanceof EvolutionError) {
    if ([401, 403].includes(error.status ?? 0)) {
      return {
        code: 'SETUP_REQUIRED',
        message: 'A Evolution recusou as credenciais. Revise a conexao pelo painel.',
        setupRequired: true,
      };
    }
    return {
      code: 'EVOLUTION_UNAVAILABLE',
      message: 'A Evolution ainda nao respondeu. Tente novamente ou abra o painel.',
      setupRequired: false,
    };
  }
  return {
    code: 'LAUNCHER_ERROR',
    message: 'O launcher nao conseguiu verificar o WhatsErase. Abra o painel para diagnosticar.',
    setupRequired: false,
  };
}

async function main() {
  const env = loadEnv();
  const db = new Database(env.DATABASE_URL);
  const settings = new SettingsStore(db, new SecretBox(env.APP_ENCRYPTION_KEY), env);
  const audit = new AuditLogStore(db);
  let knownDaemonEnabled = false;

  const recordAudit = async (event: string, message: string) => {
    try {
      await audit.info(event, message);
    } catch {
      // A launcher operation must not be reported as failed after its state was changed.
    }
  };

  try {
    const current = await settings.get();
    knownDaemonEnabled = current.daemonEnabled;

    if (command === 'stop-daemon') {
      if (current.daemonEnabled) {
        await settings.stopDaemon();
        knownDaemonEnabled = false;
        await recordAudit('daemon.stopped_by_launcher', 'Daemon parado pelo atalho do Windows.');
      }
      send({
        ok: true,
        code: 'DAEMON_STOPPED',
        connected: false,
        state: null,
        daemonEnabled: false,
        setupRequired: false,
        qrReady: false,
        restartRequired: false,
        retryAfterMs: 0,
        message: 'Daemon parado; dados e sessao foram preservados.',
      });
      return;
    }

    const auth = await db.query<{ configured: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM auth_credentials WHERE id = 1) AS configured',
    );
    if (!auth.rows[0]?.configured) {
      send({
        ok: false,
        code: 'SETUP_REQUIRED',
        connected: false,
        state: null,
        daemonEnabled: current.daemonEnabled,
        setupRequired: true,
        qrReady: false,
        restartRequired: false,
        retryAfterMs: 0,
        message: 'Conclua a configuracao inicial pelo painel.',
      });
      return;
    }

    if (!current.evolutionApiKeyEncrypted) {
      send({
        ok: false,
        code: 'SETUP_REQUIRED',
        connected: false,
        state: null,
        daemonEnabled: current.daemonEnabled,
        setupRequired: true,
        qrReady: false,
        restartRequired: false,
        retryAfterMs: 0,
        message: 'Conclua a configuracao inicial pelo painel.',
      });
      return;
    }

    const client = new EvolutionClient(await settings.getEvolutionConnection());
    let statePayload: unknown = null;
    let instanceMissing = false;
    try {
      statePayload = await client.connectionState();
    } catch (error) {
      if (error instanceof EvolutionError && error.status === 404) instanceMissing = true;
      else throw error;
    }

    let connection = isConnected(statePayload);
    if (command === 'status') {
      send({
        ok: !instanceMissing,
        code: instanceMissing ? 'INSTANCE_MISSING' : 'STATUS',
        connected: connection.connected,
        state: connection.state,
        daemonEnabled: current.daemonEnabled,
        setupRequired: false,
        qrReady: false,
        restartRequired: false,
        retryAfterMs: connection.connected ? 0 : 5_000,
        message: instanceMissing
          ? 'A instancia ainda nao existe. Use Iniciar para cria-la.'
          : connection.connected
            ? 'WhatsApp conectado.'
            : 'WhatsApp desconectado; um QR Code e necessario.',
      });
      return;
    }

    if (command !== 'prepare') throw new Error('Unsupported launcher command');

    let connectPayload: unknown = statePayload;
    if (instanceMissing) {
      try {
        connectPayload = await client.createInstance(current.webhookUrl, await settings.getWebhookSecret());
      } catch (error) {
        if (error instanceof EvolutionError && [403, 409].includes(error.status ?? 0)) {
          try {
            connectPayload = await client.connectionState();
          } catch {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

    connection = isConnected(connectPayload);
    let qrReady = connectPayload !== null && (await persistQr(connectPayload));
    if (!connection.connected && !qrReady) {
      connectPayload = await client.connect();
      connection = isConnected(connectPayload);
      if (!connection.connected) qrReady = await persistQr(connectPayload);
    }

    if (!connection.connected) {
      try {
        connection = isConnected(await client.connectionState());
      } catch {
        // A resposta de connect/QR continua sendo a melhor informacao disponivel.
      }
    }

    if (!connection.connected) {
      if (!qrReady) qrReady = await persistQr(connectPayload);
      send({
        ok: true,
        code: qrReady ? 'QR_REQUIRED' : 'QR_PENDING',
        connected: false,
        state: connection.state ?? 'connecting',
        daemonEnabled: current.daemonEnabled,
        setupRequired: false,
        qrReady,
        restartRequired: false,
        retryAfterMs: qrReady ? 10_000 : 3_000,
        message: qrReady
          ? 'Leia o QR Code com o WhatsApp para concluir a conexao.'
          : 'Aguardando a Evolution gerar o QR Code.',
      });
      return;
    }

    let restartRequired = false;
    let daemonEnabled = current.daemonEnabled;
    if (!daemonEnabled) {
      await client.configureWebhook(current.webhookUrl, await settings.getWebhookSecret());
      await settings.startDaemon();
      daemonEnabled = true;
      knownDaemonEnabled = true;
      restartRequired = true;
      await recordAudit('daemon.started_by_launcher', 'Daemon iniciado pelo atalho do Windows.');
    }
    send({
      ok: true,
      code: 'READY',
      connected: true,
      state: connection.state ?? 'open',
      daemonEnabled,
      setupRequired: false,
      qrReady: false,
      restartRequired,
      retryAfterMs: 0,
      message: 'WhatsErase ativo e WhatsApp conectado.',
    });
  } catch (error) {
    const friendly = friendlyError(error);
    send({
      ok: false,
      code: friendly.code,
      connected: false,
      state: null,
      daemonEnabled: knownDaemonEnabled,
      setupRequired: friendly.setupRequired,
      qrReady: false,
      restartRequired: false,
      retryAfterMs: 0,
      message: friendly.message,
    });
  } finally {
    await db.close();
  }
}

await main();
