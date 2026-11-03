import type { WatchLevel } from '../config/config.js';

export type ChatKind = 'dm' | 'group';

export interface ChatRow {
  id: string;
  kind: ChatKind;
  title: string | null;
  /** Saved contact name (under the id or any alias); most DMs have no title of their own. Read-only, never stored on the chat. */
  contactName: string | null;
  /** The JID WhatsApp uses for this chat (may be the @lid twin of `id`); every gateway call uses it. */
  waJid: string;
  unreadCount: number;
  markedUnread: boolean;
  archived: boolean;
  waMutedUntil: number | null;
  watchLevel: WatchLevel;
  category: string;
  snoozeUntil: number | null;
  lastMsgTs: number | null;
  lastMsgFromMe: boolean | null;
  createdAt: number;
}

/// `absolute` comes from history sync / chats.upsert (WhatsApp's own count);
/// `live` comes from chats.update, where positive values are increments.
export type UnreadSignal = { kind: 'absolute'; count: number; markedUnread: boolean } | { kind: 'live'; value: number | null };

export interface ChatUpsert {
  id: string;
  kind: ChatKind;
  title?: string | null;
  archived?: boolean;
  waMutedUntil?: number | null;
  unread?: UnreadSignal;
  /** Raw JID from a chat-level event: always recorded, and marks it the most recent sighting. */
  waJid?: string;
  /** Raw JID used only when this upsert creates the row (e.g. a chat first seen via a message). */
  firstSeenAs?: string;
}

export interface NewMessage {
  chatId: string;
  waId: string;
  fromMe: boolean;
  /** Canonical sender (alias-resolved); joins contacts. */
  senderJid: string | null;
  /** Sender JID exactly as WhatsApp sent it, for message keys; null when unknown. */
  senderWaJid?: string | null;
  ts: number;
  text: string | null;
  mediaKind: string | null;
  quotedId: string | null;
  sentViaWasap: boolean;
}

export type MessageRow = NewMessage & {
  seq: number;
  senderName: string | null;
  editedAt: number | null;
  deletedAt: number | null;
};

export interface MessageKeyRef {
  waId: string;
  fromMe: boolean;
  ts: number;
  /** Raw sender JID as WhatsApp sent it (falls back to the canonical one), for the key's participant. */
  senderJid: string | null;
}
