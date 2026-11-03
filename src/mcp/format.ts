import type { PendingItem } from '../store/pending-query.js';
import type { ChatRow, MessageRow } from '../store/types.js';

const iso = (sec: number): string => new Date(sec * 1000).toISOString();

export interface MessageView {
  seq: number;
  ts: string;
  from: 'me' | { jid: string; name: string | null };
  text: string;
  media: string | null;
  quoted_id: string | null;
  edited: boolean;
  deleted: boolean;
}

export interface ChatView {
  id: string;
  kind: string;
  title: string | null;
  watch_level: string;
  category: string;
  unread: number;
  marked_unread: boolean;
  archived: boolean;
  muted: 'forever' | string | null;
  snoozed_until: string | null;
  last_message_at: string | null;
  last_message_from_me: boolean | null;
}

export interface PendingView extends ChatView {
  reason: string;
  latest_incoming: MessageView | null;
}

/// 'other' is any WhatsApp type wasap can't render (poll, event, template...).
function mediaLabel(kind: string | null): string {
  if (kind === null) return '';
  return kind === 'other' ? '[unsupported]' : `[${kind}]`;
}

export function formatMessage(m: MessageRow): MessageView {
  return {
    seq: m.seq,
    ts: iso(m.ts),
    // Group rows carry the participant; in a DM the sender is the chat itself.
    from: m.fromMe ? 'me' : { jid: m.senderJid ?? m.chatId, name: m.senderName },
    // Media-only messages still need something readable in a transcript.
    text: m.deletedAt !== null ? '[deleted]' : m.text || mediaLabel(m.mediaKind),
    media: m.mediaKind,
    quoted_id: m.quotedId,
    edited: m.editedAt !== null,
    deleted: m.deletedAt !== null,
  };
}

/// WhatsApp stores "muted forever" as -1; never render that as a 1969 date.
/// Expired mutes read as not muted.
function formatMuted(until: number | null, nowSec: number): 'forever' | string | null {
  if (until === null) return null;
  if (until < 0) return 'forever';
  return until > nowSec ? iso(until) : null;
}

export function formatChat(c: ChatRow, nowSec: number): ChatView {
  return {
    id: c.id,
    kind: c.kind,
    title: c.title ?? c.contactName,
    watch_level: c.watchLevel,
    category: c.category,
    unread: c.unreadCount,
    marked_unread: c.markedUnread,
    archived: c.archived,
    muted: formatMuted(c.waMutedUntil, nowSec),
    snoozed_until: c.snoozeUntil !== null && c.snoozeUntil > nowSec ? iso(c.snoozeUntil) : null,
    last_message_at: c.lastMsgTs !== null ? iso(c.lastMsgTs) : null,
    last_message_from_me: c.lastMsgFromMe,
  };
}

export function formatPending(p: PendingItem, nowSec: number): PendingView {
  return { ...formatChat(p.chat, nowSec), reason: p.reason, latest_incoming: p.lastIncoming ? formatMessage(p.lastIncoming) : null };
}
