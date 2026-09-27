import type { MessageType, ParsedMessage } from '../types.js';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const MESSAGE_WRAPPERS = new Set([
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
]);

function messageContent(value: unknown) {
  let current = isRecord(value) ? value : null;
  let rawType: string | undefined;
  for (let depth = 0; current && depth < 5; depth += 1) {
    rawType = Object.keys(current)[0];
    if (!rawType || !MESSAGE_WRAPPERS.has(rawType)) break;
    const wrapper = current[rawType];
    current = isRecord(wrapper) && isRecord(wrapper.message) ? wrapper.message : null;
  }
  return { rawType, content: current };
}

function messageType(value: unknown): MessageType {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('extendedtext') || normalized === 'conversation' || normalized.includes('text')) return 'text';
  if (normalized.includes('image')) return 'image';
  if (normalized.includes('video') || normalized.includes('ptv')) return 'video';
  if (normalized.includes('audio') || normalized.includes('ptt')) return 'audio';
  if (normalized.includes('document')) return 'document';
  if (normalized.includes('sticker')) return 'sticker';
  return 'other';
}

function timestamp(value: unknown, fallback: Date) {
  let numeric: number | undefined;
  if (typeof value === 'number') numeric = value;
  else if (typeof value === 'string' && value.trim()) numeric = Number(value);
  else if (isRecord(value) && typeof value.low === 'number') numeric = value.low;
  if (!numeric || !Number.isFinite(numeric) || numeric <= 0) return fallback;
  return new Date(numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric);
}

function parseOne(data: unknown, instance: string, fallback: Date): ParsedMessage | null {
  if (!isRecord(data)) return null;
  const keyCandidate = isRecord(data.key)
    ? data.key
    : isRecord(data.message) && isRecord(data.message.key)
      ? data.message.key
      : null;
  if (!keyCandidate || keyCandidate.fromMe !== true) return null;
  const remoteJid = typeof keyCandidate.remoteJid === 'string' ? keyCandidate.remoteJid : '';
  const id = typeof keyCandidate.id === 'string' ? keyCandidate.id : '';
  if (!remoteJid || !id || remoteJid === 'status@broadcast' || remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@newsletter')) {
    return null;
  }
  const participant = typeof keyCandidate.participant === 'string' ? keyCandidate.participant : null;
  const nested = messageContent(data.message);
  const declaredType = typeof data.messageType === 'string' ? data.messageType : undefined;
  const rawType = declaredType && !MESSAGE_WRAPPERS.has(declaredType) ? declaredType : nested.rawType;
  const type = messageType(rawType);
  if (String(rawType ?? '').toLowerCase().includes('protocol')) return null;
  return {
    instance,
    remoteJid,
    participant,
    messageId: id,
    fromMe: true,
    messageType: type,
    sentAt: timestamp(data.messageTimestamp, fallback),
  };
}

export function parseEvolutionMessages(payload: unknown, now = new Date()): ParsedMessage[] {
  if (!isRecord(payload)) return [];
  const event = String(payload.event ?? '').toLowerCase().replaceAll('_', '.');
  if (event !== 'messages.upsert' && event !== 'send.message') return [];
  const instance = typeof payload.instance === 'string' ? payload.instance : '';
  if (!instance) return [];
  const fallback = typeof payload.date_time === 'string' ? new Date(payload.date_time) : now;
  const safeFallback = Number.isNaN(fallback.getTime()) ? now : fallback;
  const items = Array.isArray(payload.data) ? payload.data : [payload.data];
  return items.map((item) => parseOne(item, instance, safeFallback)).filter((item): item is ParsedMessage => item !== null);
}

export function parseEvolutionDeletedKeys(payload: unknown) {
  if (!isRecord(payload)) return [] as Array<{ instance: string; remoteJid: string; messageId: string }>;
  const event = String(payload.event ?? '').toLowerCase().replaceAll('_', '.');
  if (event !== 'messages.delete') return [];
  const instance = typeof payload.instance === 'string' ? payload.instance : '';
  const items = Array.isArray(payload.data) ? payload.data : [payload.data];
  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const key = isRecord(item.key) ? item.key : item;
    const remoteJid = typeof key.remoteJid === 'string' ? key.remoteJid : '';
    const messageId = typeof key.id === 'string' ? key.id : '';
    return instance && remoteJid && messageId ? [{ instance, remoteJid, messageId }] : [];
  });
}
