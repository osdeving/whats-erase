import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db.js';
import { AuditLogStore, sanitizeLogDetails } from '../src/services/audit-log-store.js';

describe('sanitizeLogDetails', () => {
  it('remove segredos, texto, midia e JIDs sem esconder metadados seguros', () => {
    expect(
      sanitizeLogDetails({
        apiKey: 'chave-super-secreta',
        messageText: 'conteudo privado',
        remoteJid: '5511999999999@s.whatsapp.net',
        participant: '5511888888888@s.whatsapp.net',
        messageType: 'text',
        nested: {
          token: 'eyJabcdefghijk.payload.signature',
          unsafeValue: '5511777777777@s.whatsapp.net',
          attemptCount: 2,
        },
      }),
    ).toEqual({
      apiKey: '[redacted]',
      messageText: '[redacted]',
      remoteJid: '[redacted]',
      participant: '[redacted]',
      messageType: 'text',
      nested: {
        token: '[redacted]',
        unsafeValue: '[redacted]',
        attemptCount: 2,
      },
    });
  });
});

describe('AuditLogStore', () => {
  it('persiste detalhes sanitizados e aplica a retencao depois da escrita', async () => {
    const createdAt = new Date('2026-09-26T18:00:00.000Z');
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: '12',
            level: 'warn',
            event: 'job.failed',
            message: 'Falha controlada.',
            details: { remoteJid: '[redacted]', attemptCount: 2 },
            created_at: createdAt,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const store = new AuditLogStore({ query } as unknown as Database, 25);

    const result = await store.warn('Job Failed!', 'Falha controlada.', {
      remoteJid: '5511999999999@s.whatsapp.net',
      attemptCount: 2,
    });

    expect(result).toEqual({
      id: '12',
      level: 'warn',
      event: 'job.failed',
      message: 'Falha controlada.',
      details: { remoteJid: '[redacted]', attemptCount: 2 },
      createdAt,
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]).toEqual([
      'warn',
      'job_failed_',
      'Falha controlada.',
      JSON.stringify({ remoteJid: '[redacted]', attemptCount: 2 }),
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual([25]);
  });

  it('lista por nivel com limite parametrizado', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new AuditLogStore({ query } as unknown as Database);

    await store.list('error', 200);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE level = $1'), ['error', 200]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $2'), ['error', 200]);
  });
});
