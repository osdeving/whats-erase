export type View = 'dashboard' | 'connection' | 'rules' | 'queue' | 'logs';

export interface AuthStatus {
  needsSetup: boolean;
  authenticated: boolean;
}

export interface Settings {
  evolutionBaseUrl: string;
  publicEvolutionUrl: string;
  instanceName: string;
  apiKeyConfigured: boolean;
  apiKey?: string;
  webhookUrl: string;
  defaultDelaySeconds: number;
  dryRun: boolean;
  maxAttempts: number;
}

export type HealthState = boolean | string | null | undefined;

export interface RuntimeStatus {
  daemonEnabled: boolean;
  dryRun: boolean;
  evolution?: HealthState | { connected?: boolean; state?: string; status?: string; [key: string]: unknown };
  worker?: HealthState | { running?: boolean; state?: string; status?: string; [key: string]: unknown };
  counts?: Partial<Record<'pending' | 'queued' | 'retry' | 'processing' | 'completed' | 'deleted' | 'deleted_external' | 'simulated' | 'failed' | 'cancelled' | 'total', number>>;
}

export type ChatKind = 'all' | 'direct' | 'group' | 'exact';
export type MessageType = 'all' | 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'other';
export type RuleAction = 'delete' | 'keep';
export type ContentFilter = 'any' | 'startsWith' | 'notStartsWith' | 'regex';

export interface EvolutionGroup {
  jid: string;
  name: string;
  participantCount?: number | null;
}

export interface Rule {
  id: string;
  name: string;
  priority: number;
  chatKind: ChatKind;
  chatJid?: string | null;
  messageType: MessageType;
  contentFilter: ContentFilter;
  contentPattern?: string | null;
  caseSensitive: boolean;
  action: RuleAction;
  delaySeconds: number | null;
  enabled?: boolean;
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'skipped' | string;

export interface Job {
  id: string;
  remoteJid: string;
  messageType: MessageType | string;
  sentAt: string;
  deleteAt: string;
  status: JobStatus;
  attemptCount: number;
  simulateOnly?: boolean;
  lastError?: string | null;
  ruleSnapshot?: {
    ruleId?: string | null;
    ruleName?: string;
    action?: RuleAction;
    delaySeconds?: number | null;
  } | null;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface OperationalLog {
  id: string | number;
  level: LogLevel;
  event: string;
  message: string;
  details?: Record<string, unknown> | null;
  createdAt: string;
}

export interface QrPayload {
  qrCode?: string;
  qrcode?: string;
  base64?: string;
  code?: string;
  connected?: boolean;
  state?: string;
  status?: string;
}
