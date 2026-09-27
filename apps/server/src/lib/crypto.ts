import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export class SecretBox {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('A chave de criptografia precisa ter 32 bytes.');
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
  }

  decrypt(payload: string): string {
    const [version, ivValue, tagValue, encryptedValue] = payload.split(':');
    if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
      throw new Error('Segredo cifrado em formato invalido.');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

export async function hashPassword(password: string, salt = randomBytes(16).toString('base64url')) {
  const result = (await scrypt(password, salt, 64)) as Buffer;
  return { salt, hash: result.toString('base64url') };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string) {
  const { hash } = await hashPassword(password, salt);
  const actual = Buffer.from(hash, 'base64url');
  const expected = Buffer.from(expectedHash, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sign(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSessionToken(secret: string, maxAgeSeconds = 12 * 60 * 60) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + maxAgeSeconds, nonce: randomBytes(12).toString('hex') }),
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
    return typeof parsed.exp === 'number' && parsed.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function verifyWebhookJwt(token: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return false;
  try {
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as { alg?: string; typ?: string };
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
      exp?: number;
      iat?: number;
      app?: string;
      action?: string;
    };
    if (header.alg !== 'HS256') return false;
    if (payload.app !== 'evolution' || payload.action !== 'webhook') return false;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return false;
    if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + 60 || payload.iat < nowSeconds - 900) return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest('base64url'));
    const actual = Buffer.from(signaturePart);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
