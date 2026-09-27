import { randomUUID } from 'node:crypto';

import type { Database } from '../db.js';
import type { ChatKind, ContentFilter, MessageType, Rule, RuleAction } from '../types.js';

interface RuleRow {
  id: string;
  name: string;
  priority: number;
  chat_kind: ChatKind;
  chat_jid: string | null;
  message_type: MessageType | 'all';
  content_filter: ContentFilter;
  content_pattern: string | null;
  case_sensitive: boolean;
  action: RuleAction;
  delay_seconds: number | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface RuleInput {
  name: string;
  priority: number;
  chatKind: ChatKind;
  chatJid?: string | null;
  messageType: MessageType | 'all';
  contentFilter: ContentFilter;
  contentPattern?: string | null;
  caseSensitive: boolean;
  action: RuleAction;
  delaySeconds?: number | null;
  enabled?: boolean;
}

const mapRule = (row: RuleRow): Rule => ({
  id: row.id,
  name: row.name,
  priority: row.priority,
  chatKind: row.chat_kind,
  chatJid: row.chat_jid,
  messageType: row.message_type,
  contentFilter: row.content_filter,
  contentPattern: row.content_pattern,
  caseSensitive: row.case_sensitive,
  action: row.action,
  delaySeconds: row.delay_seconds,
  enabled: row.enabled,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class RulesStore {
  constructor(private readonly db: Database) {}

  async list() {
    const result = await this.db.query<RuleRow>('SELECT * FROM rules ORDER BY priority DESC, created_at ASC');
    return result.rows.map(mapRule);
  }

  async create(input: RuleInput) {
    const id = randomUUID();
    const result = await this.db.query<RuleRow>(
      `INSERT INTO rules (
         id, name, priority, chat_kind, chat_jid, message_type,
         content_filter, content_pattern, case_sensitive, action, delay_seconds, enabled
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        id,
        input.name,
        input.priority,
        input.chatKind,
        input.chatKind === 'exact' ? input.chatJid : null,
        input.messageType,
        input.contentFilter,
        input.contentFilter === 'any' ? null : input.contentPattern,
        input.contentFilter === 'any' ? false : input.caseSensitive,
        input.action,
        input.action === 'delete' ? input.delaySeconds : null,
        input.enabled ?? true,
      ],
    );
    return mapRule(result.rows[0]!);
  }

  async update(id: string, input: RuleInput) {
    const result = await this.db.query<RuleRow>(
      `UPDATE rules
       SET name = $2, priority = $3, chat_kind = $4, chat_jid = $5, message_type = $6,
           content_filter = $7, content_pattern = $8, case_sensitive = $9,
           action = $10, delay_seconds = $11, enabled = $12, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        input.name,
        input.priority,
        input.chatKind,
        input.chatKind === 'exact' ? input.chatJid : null,
        input.messageType,
        input.contentFilter,
        input.contentFilter === 'any' ? null : input.contentPattern,
        input.contentFilter === 'any' ? false : input.caseSensitive,
        input.action,
        input.action === 'delete' ? input.delaySeconds : null,
        input.enabled ?? true,
      ],
    );
    return result.rows[0] ? mapRule(result.rows[0]) : null;
  }

  async remove(id: string) {
    const result = await this.db.query('DELETE FROM rules WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
