import type { ParsedMessage, Rule, RuleDecision } from '../types.js';

function chatMatches(rule: Rule, remoteJid: string) {
  if (rule.chatKind === 'all') return true;
  if (rule.chatKind === 'exact') return rule.chatJid === remoteJid;
  const isGroup = remoteJid.endsWith('@g.us');
  return rule.chatKind === 'group' ? isGroup : !isGroup;
}

function specificity(rule: Rule) {
  const chatScore = rule.chatKind === 'exact' ? 3 : rule.chatKind === 'all' ? 0 : 2;
  const typeScore = rule.messageType === 'all' ? 0 : 1;
  return chatScore + typeScore;
}

export function decideRule(message: ParsedMessage, rules: Rule[], defaultDelaySeconds: number): RuleDecision {
  const matches = rules.filter(
    (rule) =>
      rule.enabled &&
      chatMatches(rule, message.remoteJid) &&
      (rule.messageType === 'all' || rule.messageType === message.messageType),
  );

  const keep = matches
    .filter((rule) => rule.action === 'keep')
    .sort((a, b) => b.priority - a.priority || specificity(b) - specificity(a))[0];
  if (keep) return { action: 'keep', delaySeconds: null, ruleId: keep.id, ruleName: keep.name };

  const deletion = matches
    .filter((rule) => rule.action === 'delete')
    .sort((a, b) => b.priority - a.priority || specificity(b) - specificity(a))[0];
  if (deletion) {
    return {
      action: 'delete',
      delaySeconds: deletion.delaySeconds,
      ruleId: deletion.id,
      ruleName: deletion.name,
    };
  }

  return { action: 'delete', delaySeconds: defaultDelaySeconds, ruleId: null, ruleName: 'Regra padrao' };
}
