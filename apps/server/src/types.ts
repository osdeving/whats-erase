export const MESSAGE_TYPES = [
  'text',
  'image',
  'video',
  'audio',
  'document',
  'sticker',
  'other',
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];
export type ChatKind = 'all' | 'direct' | 'group' | 'exact';
export type RuleAction = 'delete' | 'keep';
export type JobStatus =
  | 'pending'
  | 'processing'
  | 'retry'
  | 'deleted'
  | 'simulated'
  | 'failed'
  | 'cancelled'
  | 'deleted_external';

export interface AppSettings {
  evolutionBaseUrl: string;
  publicEvolutionUrl: string;
  evolutionApiKeyEncrypted: string | null;
  instanceName: string;
  webhookUrl: string;
  webhookSecretEncrypted: string;
  defaultDelaySeconds: number;
  dryRun: boolean;
  maxAttempts: number;
  daemonEnabled: boolean;
  daemonStartedAt: Date | null;
}

export interface Rule {
  id: string;
  name: string;
  priority: number;
  chatKind: ChatKind;
  chatJid: string | null;
  messageType: MessageType | 'all';
  action: RuleAction;
  delaySeconds: number | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParsedMessage {
  instance: string;
  remoteJid: string;
  participant: string | null;
  messageId: string;
  fromMe: true;
  messageType: MessageType;
  sentAt: Date;
}

export interface RuleDecision {
  action: RuleAction;
  delaySeconds: number | null;
  ruleId: string | null;
  ruleName: string;
}

export interface ClaimedJob {
  id: string;
  instanceName: string;
  remoteJid: string;
  participant: string | null;
  messageId: string;
  messageType: MessageType;
  sentAt: Date;
  deleteAt: Date;
  attemptCount: number;
  maxAttempts: number;
  isTest: boolean;
  simulateOnly: boolean;
}
