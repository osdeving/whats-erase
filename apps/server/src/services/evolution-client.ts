export interface EvolutionConnection {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}

export interface DeleteKey {
  id: string;
  remoteJid: string;
  participant: string | null;
}

export const TRACKED_WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'SEND_MESSAGE',
  'MESSAGES_DELETE',
  'CONNECTION_UPDATE',
] as const;

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string,
    readonly permanent: boolean,
    readonly pausesDaemon: boolean,
  ) {
    super(message);
    this.name = 'EvolutionError';
  }
}

const compactMessage = (value: unknown): string => {
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) return value.map(compactMessage).join('; ').slice(0, 500);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return compactMessage(record.message ?? record.error ?? record.response ?? 'Erro retornado pela Evolution API');
  }
  return 'Erro retornado pela Evolution API';
};

export class EvolutionClient {
  private readonly baseUrl: string;

  constructor(private readonly connection: EvolutionConnection) {
    let parsed: URL;
    try {
      parsed = new URL(connection.baseUrl);
    } catch {
      throw new EvolutionError('A URL da Evolution API e invalida.', null, 'INVALID_EVOLUTION_URL', true, false);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new EvolutionError(
        'A URL da Evolution API deve usar HTTP(S), sem credenciais, query string ou fragmento.',
        null,
        'INVALID_EVOLUTION_URL',
        true,
        false,
      );
    }
    this.baseUrl = connection.baseUrl.replace(/\/+$/, '');
  }

  private url(path: string) {
    return `${this.baseUrl}${path}`;
  }

  private async request(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(this.url(path), {
        ...init,
        redirect: 'error',
        headers: {
          accept: 'application/json',
          apikey: this.connection.apiKey,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new EvolutionError(
        isTimeout ? 'Tempo esgotado ao chamar a Evolution API.' : 'Nao foi possivel acessar a Evolution API.',
        null,
        isTimeout ? 'EVOLUTION_TIMEOUT' : 'EVOLUTION_UNREACHABLE',
        false,
        false,
      );
    }

    const raw = await response.text();
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw.slice(0, 500);
      }
    }
    if (!response.ok) {
      const message = compactMessage(body);
      const authFailure = response.status === 401 || response.status === 403;
      const licenseFailure = response.status === 503 && message.includes('LICENSE_REQUIRED');
      const permanent = response.status === 400 || response.status === 404 || (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429);
      throw new EvolutionError(
        message,
        response.status,
        licenseFailure ? 'LICENSE_REQUIRED' : `EVOLUTION_HTTP_${response.status}`,
        permanent && !authFailure,
        authFailure || licenseFailure,
      );
    }
    return body;
  }

  async serverInfo() {
    return this.request('/');
  }

  async verifyCredentials() {
    return this.request('/verify-creds', { method: 'POST' });
  }

  async fetchInstances() {
    return this.request('/instance/fetchInstances');
  }

  async connectionState() {
    return this.request(`/instance/connectionState/${encodeURIComponent(this.connection.instanceName)}`);
  }

  async createInstance(webhookUrl: string, webhookSecret: string) {
    return this.request('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName: this.connection.instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        syncFullHistory: false,
        groupsIgnore: false,
        webhook: {
          enabled: true,
          url: webhookUrl,
          byEvents: false,
          base64: false,
          headers: { jwt_key: webhookSecret },
          events: TRACKED_WEBHOOK_EVENTS,
        },
      }),
    }, 30_000);
  }

  async connect() {
    return this.request(`/instance/connect/${encodeURIComponent(this.connection.instanceName)}`, {}, 30_000);
  }

  async configureWebhook(webhookUrl: string, webhookSecret: string) {
    return this.request(`/webhook/set/${encodeURIComponent(this.connection.instanceName)}`, {
      method: 'POST',
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          headers: { jwt_key: webhookSecret },
          byEvents: false,
          base64: false,
          events: TRACKED_WEBHOOK_EVENTS,
        },
      }),
    });
  }

  async webhookInfo() {
    return this.request(`/webhook/find/${encodeURIComponent(this.connection.instanceName)}`);
  }

  async deleteForEveryone(key: DeleteKey) {
    const body: Record<string, unknown> = {
      id: key.id,
      remoteJid: key.remoteJid,
      fromMe: true,
    };
    if (key.participant) body.participant = key.participant;
    return this.request(`/chat/deleteMessageForEveryone/${encodeURIComponent(this.connection.instanceName)}`, {
      method: 'DELETE',
      body: JSON.stringify(body),
    });
  }
}

export function extractQrCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const candidates = [root.qrcode, root.qr, root.base64, root.code, root.data];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 20) return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      for (const value of [nested.base64, nested.code, nested.qrcode, nested.qr]) {
        if (typeof value === 'string' && value.length > 20) return value;
      }
    }
  }
  return null;
}

export function extractConnectionState(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const containers = [root, root.instance, root.connection, root.data];
  for (const candidate of containers) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    for (const value of [record.state, record.status, record.connectionStatus]) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return null;
}

export function summarizeDeleteAcknowledgement(payload: unknown) {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  const data = root?.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : null;
  const messageContainer = [root, data]
    .map((candidate) => candidate?.message)
    .find((candidate): candidate is Record<string, unknown> => Boolean(candidate && typeof candidate === 'object'));
  const protocol = messageContainer?.protocolMessage;
  const protocolRecord = protocol && typeof protocol === 'object' ? (protocol as Record<string, unknown>) : null;
  const type = protocolRecord?.type;
  const normalizedType = typeof type === 'string' ? type.toUpperCase() : type;

  return {
    responseReceived: payload !== null && payload !== undefined,
    hasProtocolRevoke:
      Boolean(protocolRecord?.key && typeof protocolRecord.key === 'object') &&
      (normalizedType === undefined || normalizedType === 0 || normalizedType === 'REVOKE'),
  };
}
