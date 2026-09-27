import { RE2JS } from 're2js';

import type { ParsedMessage, Rule, RuleDecision } from '../types.js';

export const MAX_CONTENT_PATTERN_LENGTH = 256;
const MAX_REGEX_CACHE_SIZE = 128;
const regexCache = new Map<string, RE2JS>();

function compiledContentRegex(pattern: string, caseSensitive: boolean): RE2JS | null {
  if (!pattern || pattern.length > MAX_CONTENT_PATTERN_LENGTH) return null;
  const key = `${caseSensitive ? 's' : 'i'}:${pattern}`;
  const cached = regexCache.get(key);
  if (cached) {
    // Atualiza a ordem para manter um cache LRU pequeno e previsivel.
    regexCache.delete(key);
    regexCache.set(key, cached);
    return cached;
  }
  try {
    // RE2JS nao usa backtracking exponencial e recusa recursos incompativeis
    // com tempo linear, como backreferences e lookaround.
    const compiled = RE2JS.compile(pattern, caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE);
    if (regexCache.size >= MAX_REGEX_CACHE_SIZE) {
      const oldest = regexCache.keys().next().value as string | undefined;
      if (oldest !== undefined) {
        regexCache.get(oldest)?.reset();
        regexCache.delete(oldest);
      }
    }
    regexCache.set(key, compiled);
    return compiled;
  } catch {
    return null;
  }
}

export function isSafeContentRegex(pattern: string, caseSensitive = false) {
  return compiledContentRegex(pattern, caseSensitive) !== null;
}

function chatMatches(rule: Rule, remoteJid: string) {
  if (rule.chatKind === 'all') return true;
  if (rule.chatKind === 'exact') return rule.chatJid === remoteJid;
  const isGroup = remoteJid.endsWith('@g.us');
  return rule.chatKind === 'group' ? isGroup : !isGroup;
}

function contentMatches(rule: Rule, text: string | null | undefined) {
  const filter = rule.contentFilter ?? 'any';
  if (filter === 'any') return true;
  // `undefined` e usado pelo worker: o texto original deliberadamente nao e
  // persistido, portanto um filtro textual nunca pode ser inferido nessa fase.
  if (text === undefined) return false;

  const pattern = rule.contentPattern;
  if (!pattern || pattern.length > MAX_CONTENT_PATTERN_LENGTH) return false;
  const comparableText = rule.caseSensitive ? text ?? '' : (text ?? '').toLowerCase();
  const comparablePattern = rule.caseSensitive ? pattern : pattern.toLowerCase();
  if (filter === 'startsWith') return text !== null && comparableText.startsWith(comparablePattern);
  if (filter === 'notStartsWith') return text === null || !comparableText.startsWith(comparablePattern);
  if (filter === 'regex') {
    if (text === null) return false;
    try {
      return compiledContentRegex(pattern, rule.caseSensitive)?.test(text) ?? false;
    } catch {
      // Regras invalidas inseridas fora da API falham fechadas.
      return false;
    }
  }
  return false;
}

export function ruleMatches(rule: Rule, message: ParsedMessage) {
  return (
    rule.enabled &&
    chatMatches(rule, message.remoteJid) &&
    (rule.messageType === 'all' || rule.messageType === message.messageType) &&
    contentMatches(rule, message.textContent)
  );
}

function specificity(rule: Rule) {
  const chatScore = rule.chatKind === 'exact' ? 3 : rule.chatKind === 'all' ? 0 : 2;
  const typeScore = rule.messageType === 'all' ? 0 : 1;
  const contentScore = (rule.contentFilter ?? 'any') === 'any' ? 0 : 1;
  return chatScore + typeScore + contentScore;
}

export function decideRule(message: ParsedMessage, rules: Rule[], _legacyDefaultDelaySeconds?: number): RuleDecision {
  const matches = rules.filter((rule) => ruleMatches(rule, message));

  const keep = matches
    .filter((rule) => rule.action === 'keep')
    .sort((a, b) => b.priority - a.priority || specificity(b) - specificity(a))[0];
  if (keep) {
    return {
      action: 'keep',
      delaySeconds: null,
      ruleId: keep.id,
      ruleName: keep.name,
      ruleUpdatedAt: keep.updatedAt.toISOString(),
    };
  }

  const deletion = matches
    .filter((rule) => rule.action === 'delete')
    .sort((a, b) => b.priority - a.priority || specificity(b) - specificity(a))[0];
  if (deletion) {
    return {
      action: 'delete',
      delaySeconds: deletion.delaySeconds,
      ruleId: deletion.id,
      ruleName: deletion.name,
      ruleUpdatedAt: deletion.updatedAt.toISOString(),
    };
  }

  return {
    action: 'keep',
    delaySeconds: null,
    ruleId: null,
    ruleName: 'Sem regra correspondente',
    ruleUpdatedAt: null,
  };
}
