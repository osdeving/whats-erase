import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db.js';
import type { ParsedMessage, RuleDecision } from '../src/types.js';
import { JobsStore } from '../src/services/jobs-store.js';

describe('JobsStore.schedule', () => {
  it('nao envia o conteudo transitorio da mensagem ao banco', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'job-1' }] });
    const store = new JobsStore({ query } as unknown as Database);
    const message: ParsedMessage = {
      instance: 'personal',
      remoteJid: '120363@g.us',
      participant: '5511@s.whatsapp.net',
      messageId: 'MSG-1',
      fromMe: true,
      messageType: 'text',
      textContent: 'SEGREDO-QUE-NAO-PODE-IR-AO-BANCO',
      sentAt: new Date('2026-09-26T18:00:00.000Z'),
    };
    const decision: RuleDecision = {
      action: 'delete',
      delaySeconds: 900,
      ruleId: 'rule-1',
      ruleName: 'Temporarias',
      ruleUpdatedAt: '2026-09-26T17:00:00.000Z',
    };

    await store.schedule(message, decision, 5, false);

    const serializedCall = JSON.stringify(query.mock.calls[0]);
    expect(serializedCall).not.toContain(message.textContent);
    expect(serializedCall).toContain('ruleUpdatedAt');
  });
});
