import type { Db } from './db.js';
import type { MessageKeyRef, MessageRow, NewMessage } from './types.js';

const bit = (b: boolean): number => (b ? 1 : 0);

export function rowToMessage(r: Record<string, unknown>): MessageRow {
  return {
    seq: Number(r.seq),
    chatId: String(r.chat_id),
    waId: String(r.wa_id),
    fromMe: r.from_me === 1,
    senderJid: (r.sender_jid as string | null) ?? null,
    senderName: (r.sender_name as string | null) ?? null,
    ts: Number(r.ts),
    text: (r.text as string | null) ?? null,
    mediaKind: (r.media_kind as string | null) ?? null,
    quotedId: (r.quoted_id as string | null) ?? null,
    editedAt: r.edited_at === null ? null : Number(r.edited_at),
    deletedAt: r.deleted_at === null ? null : Number(r.deleted_at),
    sentViaWasap: r.sent_via_wasap === 1,
  };
}

// m.* plus the sender's saved name, if we have one.
const SELECT_MESSAGE = `SELECT m.*, c.name AS sender_name FROM messages m LEFT JOIN contacts c ON c.jid = m.sender_jid`;

/// Quote every token so Claude's search text is matched literally: raw FTS5
/// syntax (quotes, parens, OR, NEAR, *, -) would otherwise throw SQL errors.
/// C0 control characters are stripped first: SQLite's FTS5 parser treats a
/// NUL as end of string even inside quotes ("unterminated string").
/// Tab/LF/VT/FF/CR are left for the whitespace split.
function toFtsQuery(query: string): string | null {
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  const cleaned = query.replace(/[\u0000-\u0008\u000e-\u001f\u007f]/g, '');
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  return tokens.length ? tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ') : null;
}

export class MessagesRepo {
  constructor(private readonly db: Db) {}

  /// Duplicates on (chat_id, wa_id) are ignored, so history sync and live
  /// events can overlap. Also moves chats.last_msg_* forward (never back).
  insertMany(rows: NewMessage[]): number {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO messages (chat_id, wa_id, from_me, sender_jid, ts, text, media_kind, quoted_id, sent_via_wasap)
       VALUES (@chatId, @waId, @fromMe, @senderJid, @ts, @text, @mediaKind, @quotedId, @sent)`,
    );
    const touch = this.db.prepare(
      'UPDATE chats SET last_msg_ts = @ts, last_msg_from_me = @mine WHERE id = @id AND (last_msg_ts IS NULL OR @ts >= last_msg_ts)',
    );
    return this.db.transaction((batch: NewMessage[]): number => {
      let inserted = 0;
      for (const m of batch) {
        const res = insert.run({ ...m, fromMe: bit(m.fromMe), sent: bit(m.sentViaWasap) });
        if (res.changes === 1) {
          inserted++;
          touch.run({ ts: m.ts, mine: bit(m.fromMe), id: m.chatId });
        }
      }
      return inserted;
    })(rows);
  }

  /// After an alias merge, the loser's sender id becomes the winner's. The FTS
  /// trigger fires on text only, so this leaves the index alone.
  repointSender(from: string, to: string): void {
    if (from === to) return;
    this.db.prepare('UPDATE messages SET sender_jid = ? WHERE sender_jid = ?').run(to, from);
  }

  editText(chatId: string, waId: string, text: string, editedAt: number): void {
    this.db
      .prepare('UPDATE messages SET text = ?, edited_at = ? WHERE chat_id = ? AND wa_id = ? AND deleted_at IS NULL')
      .run(text, editedAt, chatId, waId);
  }

  /// Text is dropped on delete: a deleted message must not stay searchable.
  softDelete(chatId: string, waId: string, deletedAt: number): void {
    this.db.prepare('UPDATE messages SET deleted_at = ?, text = NULL WHERE chat_id = ? AND wa_id = ? AND deleted_at IS NULL').run(deletedAt, chatId, waId);
  }

  /// Newest first by (ts, seq): history sync sends newest chunks first, so seq
  /// alone would put backfilled older messages on top. `beforeSeq` is a keyset
  /// cursor on that same (ts, seq) order; a seq not in this chat yields nothing.
  history(chatId: string, o: { limit: number; beforeSeq?: number }): MessageRow[] {
    if (o.beforeSeq === undefined) {
      return (
        this.db
          .prepare(`${SELECT_MESSAGE} WHERE m.chat_id = ? ORDER BY m.ts DESC, m.seq DESC LIMIT ?`)
          .all(chatId, o.limit) as Record<string, unknown>[]
      ).map(rowToMessage);
    }
    const cursor = this.db.prepare('SELECT ts FROM messages WHERE chat_id = ? AND seq = ?').get(chatId, o.beforeSeq) as { ts: number } | undefined;
    if (!cursor) return [];
    return (
      this.db
        .prepare(
          `${SELECT_MESSAGE} WHERE m.chat_id = @chatId AND (m.ts < @ts OR (m.ts = @ts AND m.seq < @seq))
           ORDER BY m.ts DESC, m.seq DESC LIMIT @limit`,
        )
        .all({ chatId, ts: cursor.ts, seq: o.beforeSeq, limit: o.limit }) as Record<string, unknown>[]
    ).map(rowToMessage);
  }

  search(q: string, o: { chatId?: string; limit: number }): MessageRow[] {
    const fts = toFtsQuery(q);
    if (!fts) return [];
    const params: Record<string, unknown> = { fts, limit: o.limit };
    if (o.chatId !== undefined) params.chatId = o.chatId;
    const sql = `${SELECT_MESSAGE} JOIN messages_fts f ON f.rowid = m.seq
                 WHERE messages_fts MATCH @fts AND m.deleted_at IS NULL ${o.chatId !== undefined ? 'AND m.chat_id = @chatId' : ''}
                 ORDER BY m.ts DESC, m.seq DESC LIMIT @limit`;
    return (this.db.prepare(sql).all(params) as Record<string, unknown>[]).map(rowToMessage);
  }

  /// Newest by timestamp (not seq): backfilled history gets later seqs.
  latestKey(chatId: string): MessageKeyRef | null {
    const r = this.db
      .prepare('SELECT wa_id, from_me, ts, sender_jid FROM messages WHERE chat_id = ? ORDER BY ts DESC, seq DESC LIMIT 1')
      .get(chatId) as { wa_id: string; from_me: number; ts: number; sender_jid: string | null } | undefined;
    return r ? { waId: r.wa_id, fromMe: r.from_me === 1, ts: r.ts, senderJid: r.sender_jid } : null;
  }

  /// Reference to one stored message, for quoting it in a reply.
  keyOf(chatId: string, waId: string): MessageKeyRef | null {
    const r = this.db
      .prepare('SELECT wa_id, from_me, ts, sender_jid FROM messages WHERE chat_id = ? AND wa_id = ?')
      .get(chatId, waId) as { wa_id: string; from_me: number; ts: number; sender_jid: string | null } | undefined;
    return r ? { waId: r.wa_id, fromMe: r.from_me === 1, ts: r.ts, senderJid: r.sender_jid } : null;
  }

  lastOutgoingTs(chatId: string): number | null {
    const r = this.db.prepare('SELECT max(ts) AS ts FROM messages WHERE chat_id = ? AND from_me = 1').get(chatId) as { ts: number | null };
    return r.ts;
  }

  /// Newest first by (ts, seq), like `history`. `textOnly` filters in SQL (not
  /// deleted, has text) so the limit counts usable samples: a chat full of
  /// audios or revoked messages must not shrink it.
  outgoing(chatIds: string[], o: { limit: number; textOnly?: boolean }): MessageRow[] {
    if (chatIds.length === 0) return [];
    const marks = chatIds.map(() => '?').join(',');
    return (
      this.db
        .prepare(`${SELECT_MESSAGE} WHERE m.from_me = 1 AND m.chat_id IN (${marks})${o.textOnly ? " AND m.deleted_at IS NULL AND m.text IS NOT NULL AND m.text != ''" : ''} ORDER BY m.ts DESC, m.seq DESC LIMIT ?`)
        .all(...chatIds, o.limit) as Record<string, unknown>[]
    ).map(rowToMessage);
  }

  countOutgoingSince(chatIds: string[], sinceSec: number): number {
    if (chatIds.length === 0) return 0;
    const marks = chatIds.map(() => '?').join(',');
    const r = this.db
      .prepare(`SELECT count(*) AS n FROM messages WHERE from_me = 1 AND ts >= ? AND chat_id IN (${marks})`)
      .get(sinceSec, ...chatIds) as { n: number };
    return r.n;
  }

  getText(chatId: string, waId: string): string | null {
    const r = this.db.prepare('SELECT text FROM messages WHERE chat_id = ? AND wa_id = ?').get(chatId, waId) as { text: string | null } | undefined;
    return r?.text ?? null;
  }
}
