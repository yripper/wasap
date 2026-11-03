import type { PendingReason } from '../domain/pending.js';
import { rowToChat } from './chats-repo.js';
import type { Db } from './db.js';
import { rowToMessage } from './messages-repo.js';
import type { ChatRow, MessageRow } from './types.js';

export interface PendingItem {
  chat: ChatRow;
  reason: PendingReason;
  lastIncoming: MessageRow | null;
}

// SQL mirror of pendingReason (src/domain/pending.ts); the test checks they agree.
const PENDING_SQL = `
  SELECT *, CASE WHEN marked_unread = 1 THEN 'marked_unread' ELSE 'unread' END AS reason
  FROM chats
  WHERE archived = 0 AND watch_level != 'muted'
    AND (snooze_until IS NULL OR snooze_until <= @now)
    AND (marked_unread = 1 OR (unread_count > 0 AND (kind = 'dm' OR watch_level = 'full')))
  ORDER BY marked_unread DESC, watch_level = 'full' DESC, last_msg_ts IS NULL, last_msg_ts DESC, id
  LIMIT @limit`;

const LAST_INCOMING_SQL = `
  SELECT m.*, c.name AS sender_name FROM messages m LEFT JOIN contacts c ON c.jid = m.sender_jid
  WHERE m.chat_id = ? AND m.from_me = 0 AND m.deleted_at IS NULL
  ORDER BY m.ts DESC, m.seq DESC LIMIT 1`;

export function listPending(db: Db, nowSec: number, limit: number): PendingItem[] {
  const last = db.prepare(LAST_INCOMING_SQL);
  const rows = db.prepare(PENDING_SQL).all({ now: nowSec, limit }) as Record<string, unknown>[];
  return rows.map((r) => {
    const m = last.get(String(r.id)) as Record<string, unknown> | undefined;
    return { chat: rowToChat(r), reason: r.reason as PendingReason, lastIncoming: m ? rowToMessage(m) : null };
  });
}
