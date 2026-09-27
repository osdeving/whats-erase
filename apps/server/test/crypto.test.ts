import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createSessionToken, SecretBox, verifySessionToken, verifyWebhookJwt } from '../src/lib/crypto.js';

function webhookToken(payload: Record<string, unknown>, secret: string, algorithm = 'HS256') {
  const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

describe('SecretBox', () => {
  it('cifra com nonce aleatorio e autentica o conteudo', () => {
    const box = new SecretBox(Buffer.alloc(32, 7).toString('base64'));
    const first = box.encrypt('segredo');
    const second = box.encrypt('segredo');
    expect(first).not.toBe(second);
    expect(box.decrypt(first)).toBe('segredo');
    const parts = first.split(':');
    const encrypted = Buffer.from(parts[3]!, 'base64url');
    encrypted[0] = encrypted[0]! ^ 1;
    parts[3] = encrypted.toString('base64url');
    expect(() => box.decrypt(parts.join(':'))).toThrow();
  });
});

describe('tokens', () => {
  it('valida sessao assinada e rejeita adulteracao', () => {
    const token = createSessionToken('s'.repeat(32), 60);
    expect(verifySessionToken(token, 's'.repeat(32))).toBe(true);
    expect(verifySessionToken(`${token}x`, 's'.repeat(32))).toBe(false);
    expect(verifySessionToken(token, 'x'.repeat(32))).toBe(false);
  });

  it('valida exatamente o JWT HS256 produzido pelo webhook da Evolution', () => {
    const now = 1_800_000_000;
    const secret = 'webhook-secret';
    const valid = webhookToken({ iat: now, exp: now + 600, app: 'evolution', action: 'webhook' }, secret);
    expect(verifyWebhookJwt(valid, secret, now)).toBe(true);

    const expired = webhookToken({ iat: now - 600, exp: now, app: 'evolution', action: 'webhook' }, secret);
    expect(verifyWebhookJwt(expired, secret, now)).toBe(false);
    const wrongAction = webhookToken({ iat: now, exp: now + 600, app: 'evolution', action: 'admin' }, secret);
    expect(verifyWebhookJwt(wrongAction, secret, now)).toBe(false);
    const wrongAlgorithm = webhookToken({ iat: now, exp: now + 600, app: 'evolution', action: 'webhook' }, secret, 'none');
    expect(verifyWebhookJwt(wrongAlgorithm, secret, now)).toBe(false);
  });
});
