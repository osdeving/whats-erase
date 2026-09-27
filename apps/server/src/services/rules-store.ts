import { randomUUID } from 'node:crypto';

import type { Database } from '../db.js';
import type { ChatKind, MessageType, Rule, RuleAction } from '../types.js';

interface RuleRow {
  id: string;
  name: string;
  priority: number;
  chat_kind: ChatKind;
  chat_jid: string | null;
  message_type: MessageType | 'all';
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
      `INSERT INTO rules (id, name, priority, chat_kind, chat_jid, message_type, action, delay_seconds, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        input.name,
        input.priority,
        input.chatKind,
        input.chatKind === 'exact' ? input.chatJid : null,
        input.messageType,
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
           action = $7, delay_seconds = $8, enabled = $9, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        input.name,
        input.priority,
        input.chatKind,
        input.chatKind === 'exact' ? input.chatJid : null,
        input.messageType,
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
