import { describe, expect, it } from 'vitest';

import type { ParsedMessage, Rule } from '../src/types.js';
import { decideRule, isSafeContentRegex, ruleMatches } from '../src/services/rule-engine.js';

const revision = new Date('2026-09-26T18:00:00.000Z');

function message(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    instance: 'personal',
    remoteJid: '120363000000@g.us',
    participant: '5511@s.whatsapp.net',
    messageId: 'MSG-1',
    fromMe: true,
    messageType: 'text',
    textContent: 'Apagar esta mensagem',
    sentAt: revision,
    ...overrides,
  };
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'rule-1',
    name: 'Grupo especifico',
    priority: 0,
    chatKind: 'exact',
    chatJid: '120363000000@g.us',
    messageType: 'all',
    contentFilter: 'any',
    contentPattern: null,
    caseSensitive: false,
    action: 'delete',
    delaySeconds: 900,
    enabled: true,
    createdAt: revision,
    updatedAt: revision,
    ...overrides,
  };
}

describe('decideRule', () => {
  it('mantem a mensagem quando nenhuma regra explicita corresponde', () => {
    expect(decideRule(message(), [], 10)).toEqual({
      action: 'keep',
      delaySeconds: null,
      ruleId: null,
      ruleName: 'Sem regra correspondente',
      ruleUpdatedAt: null,
    });
  });

  it('combina grupo exato e prefixo sem diferenciar maiusculas por padrao', () => {
    const decision = decideRule(
      message({ textContent: 'APAGAR depois de ler' }),
      [rule({ contentFilter: 'startsWith', contentPattern: 'apagar' })],
    );

    expect(decision).toEqual({
      action: 'delete',
      delaySeconds: 900,
      ruleId: 'rule-1',
      ruleName: 'Grupo especifico',
      ruleUpdatedAt: revision.toISOString(),
    });
    expect(
      decideRule(
        message({ remoteJid: 'outro@g.us', textContent: 'apagar depois' }),
        [rule({ contentFilter: 'startsWith', contentPattern: 'apagar' })],
      ).action,
    ).toBe('keep');
  });

  it('implementa exceto prefixo inclusive para mensagens sem caption', () => {
    const exceptCommand = rule({ contentFilter: 'notStartsWith', contentPattern: '!fixar' });

    expect(decideRule(message({ textContent: '!FIXAR importante' }), [exceptCommand]).action).toBe('keep');
    expect(decideRule(message({ textContent: 'temporaria' }), [exceptCommand]).action).toBe('delete');
    expect(decideRule(message({ messageType: 'image', textContent: null }), [exceptCommand]).action).toBe('delete');
  });

  it('aplica regex em motor linear e rejeita recursos incompativeis com RE2', () => {
    const regex = rule({ contentFilter: 'regex', contentPattern: '^ticket-[0-9]+$' });
    expect(decideRule(message({ textContent: 'TICKET-42' }), [regex]).action).toBe('delete');
    expect(decideRule(message({ textContent: 'ticket-x' }), [regex]).action).toBe('keep');

    // Padroes ruins para engines de backtracking continuam previsiveis no RE2.
    expect(isSafeContentRegex('(a+)+$')).toBe(true);
    expect(isSafeContentRegex('a*a*a*a*a*a*a*a*a*b')).toBe(true);
    expect(isSafeContentRegex('(?=apagar)apagar')).toBe(false);
    expect(ruleMatches(rule({ contentFilter: 'regex', contentPattern: '(?=apagar)apagar' }), message())).toBe(false);
  });

  it('nao tenta inferir filtro textual quando o worker nao possui o conteudo', () => {
    expect(
      ruleMatches(
        rule({ contentFilter: 'notStartsWith', contentPattern: '!fixar' }),
        message({ textContent: undefined }),
      ),
    ).toBe(false);
    expect(
      ruleMatches(
        rule({ contentFilter: 'regex', contentPattern: 'FIM$' }),
        message({ textContent: undefined }),
      ),
    ).toBe(false);
  });

  it('faz uma regra KEEP explicita prevalecer sobre regras de exclusao', () => {
    const keep = rule({ id: 'keep-1', name: 'Protecao', action: 'keep', delaySeconds: null, priority: -10 });
    expect(decideRule(message(), [rule({ priority: 100 }), keep])).toEqual(
      expect.objectContaining({ action: 'keep', ruleId: 'keep-1' }),
    );
  });
});
