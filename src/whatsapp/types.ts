import type { ChatKind, MessageKeyRef, NewMessage, UnreadSignal } from '../store/types.js';

export type { MessageKeyRef };

export interface WaChat {
  id: string;
  kind: ChatKind;
  title: string | null;
  unread: UnreadSignal | null;
  archived: boolean | null;
  /** Unix seconds (WhatsApp sends ms; converted in adapt.ts); -1 = muted forever; null = unmuted; undefined = the event carried no mute info. */
  mutedUntil: number | null | undefined;
}

/// `chatId` is exactly what Baileys gave us (possibly an @lid), before alias resolution.
/** `pushName` is the sender's own WhatsApp profile name, only on incoming messages that carry one. */
export type WaMessage = Omit<NewMessage, 'sentViaWasap'> & { senderAltJid: string | null; pushName?: string };

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'logged_out' | 'gave_up';

export type WaEvent =
  | { kind: 'chats'; chats: WaChat[] }
  | { kind: 'messages'; messages: WaMessage[] }
  | { kind: 'edit'; chatId: string; waId: string; text: string; ts: number }
  | { kind: 'revoke'; chatId: string; waId: string; ts: number }
  | { kind: 'aliases'; pairs: { lid: string; pn: string }[] }
  | { kind: 'contacts'; contacts: { jid: string; name: string }[] }
  | { kind: 'connection'; state: ConnectionState };

export interface WhatsAppGateway {
  onEvent(h: (e: WaEvent) => void): void;
  sendText(chatId: string, text: string, quoted?: MessageKeyRef): Promise<{ waId: string; ts: number }>;
  markRead(chatId: string, last: MessageKeyRef): Promise<void>;
  setArchived(chatId: string, archived: boolean, last: MessageKeyRef): Promise<void>;
  setMuted(chatId: string, untilSec: number | null): Promise<void>;
  leaveGroup(chatId: string): Promise<void>;
  groupTitle(chatId: string): Promise<string | null>;
  /// The JID WhatsApp knows for a phone-number JID, or null when the number has no account.
  onWhatsApp(phoneJid: string): Promise<string | null>;
  state(): ConnectionState;
  /// Closes the connection for good (daemon shutdown); no reconnect afterwards.
  stop(): Promise<void>;
}
