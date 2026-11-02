import type { WatchLevel } from '../config/config.js';
import type { Db } from './db.js';
import type { ChatKind, ChatRow, ChatUpsert, UnreadSignal } from './types.js';

export interface ChatFilter {
  kind?: ChatKind;
  watchLevel?: WatchLevel;
  category?: string;
  query?: string;
  limit: number;
  offset: number;
}

export function rowToChat(r: Record<string, unknown>): ChatRow {
  return {
    id: String(r.id),
    kind: r.kind as ChatKind,
    title: (r.title as string | null) ?? null,
    waJid: String(r.wa_jid ?? r.id),
    unreadCount: Number(r.unread_count),
    markedUnread: r.marked_unread === 1,
    archived: r.archived === 1,
    waMutedUntil: r.wa_muted_until === null ? null : Number(r.wa_muted_until),
    watchLevel: r.watch_level as WatchLevel,
    category: String(r.category),
    snoozeUntil: r.snooze_until === null ? null : Number(r.snooze_until),
    lastMsgTs: r.last_msg_ts === null ? null : Number(r.last_msg_ts),
    lastMsgFromMe: r.last_msg_from_me === null ? null : r.last_msg_from_me === 1,
    createdAt: Number(r.created_at),
  };
}

const bit = (b: boolean): number => (b ? 1 : 0);

export class ChatsRepo {
  constructor(
    private readonly db: Db,
    private readonly defaultWatch: (kind: ChatKind) => WatchLevel,
  ) {}

  /// Watch level, category and snooze are only set locally: a re-sync from
  /// WhatsApp must never reset them, so the conflict branch skips them.
  upsert(c: ChatUpsert, nowSec: number): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO chats (id, kind, title, archived, wa_muted_until, watch_level, created_at, wa_jid, wa_jid_rank)
           VALUES (@id, @kind, @title, @archived, @muted, @watch, @now, COALESCE(@waJid, @firstSeen, @id),
                   CASE WHEN @waJid IS NULL THEN 0 ELSE (SELECT COALESCE(MAX(wa_jid_rank), 0) + 1 FROM chats) END)
           ON CONFLICT (id) DO UPDATE SET
             kind = excluded.kind,
             wa_jid = COALESCE(@waJid, wa_jid),
             wa_jid_rank = CASE WHEN @waJid IS NULL THEN wa_jid_rank ELSE (SELECT COALESCE(MAX(wa_jid_rank), 0) + 1 FROM chats) END,
             title = COALESCE(@title, title),
             archived = CASE WHEN @archivedGiven = 1 THEN excluded.archived ELSE archived END,
             wa_muted_until = CASE WHEN @mutedGiven = 1 THEN excluded.wa_muted_until ELSE wa_muted_until END`,
        )
        .run({
          id: c.id,
          kind: c.kind,
          title: c.title ?? null,
          archived: bit(c.archived ?? false),
          archivedGiven: bit(c.archived !== undefined),
          muted: c.waMutedUntil ?? null,
          mutedGiven: bit(c.waMutedUntil !== undefined),
          watch: this.defaultWatch(c.kind),
          now: nowSec,
          waJid: c.waJid ?? null,
          firstSeen: c.firstSeenAs ?? null,
        });
      if (c.unread) this.applyUnread(c.id, c.unread);
    })();
  }

  /// Stored count is never negative; WhatsApp's -1 becomes marked_unread.
  applyUnread(id: string, s: UnreadSignal): void {
    if (s.kind === 'absolute') {
      this.db
        .prepare('UPDATE chats SET unread_count = MAX(?, 0), marked_unread = ? WHERE id = ?')
        .run(s.count, bit(s.markedUnread || s.count < 0), id);
      return;
    }
    const v = s.value;
    if (v === null) return;
    if (v < 0) {
      this.db.prepare('UPDATE chats SET marked_unread = 1 WHERE id = ?').run(id);
    } else if (v === 0) {
      this.db.prepare('UPDATE chats SET unread_count = 0, marked_unread = 0 WHERE id = ?').run(id);
    } else {
      // Live positives are increments (Baileys' event buffer adds them).
      this.db.prepare('UPDATE chats SET unread_count = MAX(unread_count, 0) + ? WHERE id = ?').run(v, id);
    }
  }

  get(id: string): ChatRow | null {
    const r = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? rowToChat(r) : null;
  }

  list(f: ChatFilter): ChatRow[] {
    const where: string[] = [];
    const params: Record<string, unknown> = { limit: f.limit, offset: f.offset };
    if (f.kind) {
      where.push('kind = @kind');
      params.kind = f.kind;
    }
    if (f.watchLevel) {
      where.push('watch_level = @watch');
      params.watch = f.watchLevel;
    }
    if (f.category) {
      where.push('category = @category');
      params.category = f.category;
    }
    if (f.query) {
      where.push("(title LIKE @q ESCAPE '\\' OR id LIKE @q ESCAPE '\\')");
      params.q = `%${f.query.replace(/[\\%_]/g, '\\$&')}%`;
    }
    const sql = `SELECT * FROM chats ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY last_msg_ts IS NULL, last_msg_ts DESC, id LIMIT @limit OFFSET @offset`;
    return (this.db.prepare(sql).all(params) as Record<string, unknown>[]).map(rowToChat);
  }

  setWatchLevel(id: string, level: WatchLevel): void {
    this.db.prepare('UPDATE chats SET watch_level = ? WHERE id = ?').run(level, id);
  }

  setCategory(id: string, category: string): void {
    this.db.prepare('UPDATE chats SET category = ? WHERE id = ?').run(category, id);
  }

  setSnooze(id: string, untilSec: number | null): void {
    this.db.prepare('UPDATE chats SET snooze_until = ? WHERE id = ?').run(untilSec, id);
  }

  setArchived(id: string, v: boolean): void {
    this.db.prepare('UPDATE chats SET archived = ? WHERE id = ?').run(bit(v), id);
  }

  setWaMuted(id: string, until: number | null): void {
    this.db.prepare('UPDATE chats SET wa_muted_until = ? WHERE id = ?').run(until, id);
  }

  /// Forward-only so backfilled history can't move the "last message" back.
  touchLastMessage(id: string, ts: number, fromMe: boolean): void {
    this.db
      .prepare('UPDATE chats SET last_msg_ts = @ts, last_msg_from_me = @mine WHERE id = @id AND (last_msg_ts IS NULL OR @ts >= last_msg_ts)')
      .run({ ts, mine: bit(fromMe), id });
  }

  /// Folds a duplicate chat (e.g. the @lid twin of a phone-number chat) into
  /// the surviving one. Local fields come from the older row, since that is
  /// the one the user has been curating; wa_jid from the row whose JID
  /// WhatsApp used most recently (tie: `into`).
  mergeInto(fromId: string, intoId: string): void {
    if (fromId === intoId) return;
    this.db.transaction(() => {
      const from = this.get(fromId);
      if (!from) return;
      const into = this.get(intoId);
      if (!into) {
        this.db.prepare('UPDATE chats SET id = ? WHERE id = ?').run(intoId, fromId);
        this.db.prepare('UPDATE messages SET chat_id = ? WHERE chat_id = ?').run(intoId, fromId);
        return;
      }
      // OR IGNORE leaves duplicates (same wa_id) behind; the DELETE drops them
      // and the delete trigger keeps FTS consistent.
      this.db.prepare('UPDATE OR IGNORE messages SET chat_id = ? WHERE chat_id = ?').run(intoId, fromId);
      this.db.prepare('DELETE FROM messages WHERE chat_id = ?').run(fromId);

      const local = from.createdAt < into.createdAt ? from : into;
      const rank = this.db.prepare('SELECT wa_jid_rank AS r FROM chats WHERE id = ?');
      const seen = (rank.get(fromId) as { r: number }).r > (rank.get(intoId) as { r: number }).r ? fromId : intoId;
      const newer = from.lastMsgTs !== null && (into.lastMsgTs === null || from.lastMsgTs > into.lastMsgTs) ? from : into;
      this.db
        .prepare(
          `UPDATE chats SET watch_level = @watch, category = @category, snooze_until = @snooze, created_at = @created,
             unread_count = @unread, marked_unread = @marked, title = @title,
             last_msg_ts = @lastTs, last_msg_from_me = @lastMine,
             (wa_jid, wa_jid_rank) = (SELECT wa_jid, wa_jid_rank FROM chats WHERE id = @seen)
           WHERE id = @id`,
        )
        .run({
          id: intoId,
          watch: local.watchLevel,
          category: local.category,
          snooze: local.snoozeUntil,
          created: Math.min(from.createdAt, into.createdAt),
          unread: from.unreadCount + into.unreadCount,
          marked: bit(from.markedUnread || into.markedUnread),
          title: into.title ?? from.title,
          lastTs: newer.lastMsgTs,
          lastMine: newer.lastMsgFromMe === null ? null : bit(newer.lastMsgFromMe),
          seen,
        });
      this.db.prepare('DELETE FROM chats WHERE id = ?').run(fromId);
    })();
  }
}
