import type { WatchLevel } from '../config/config.js';

export type ChatKind = 'dm' | 'group';

export interface ChatRow {
  id: string;
  kind: ChatKind;
  title: string | null;
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
}

export interface NewMessage {
  chatId: string;
  waId: string;
  fromMe: boolean;
  senderJid: string | null;
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
  senderJid: string | null;
}
