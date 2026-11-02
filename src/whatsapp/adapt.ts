import { normalizeMessageContent, proto, toNumber, type Chat, type Contact, type WAMessage } from '@whiskeysockets/baileys';
import type { ChatKind } from '../store/types.js';
import type { WaChat, WaEvent, WaMessage } from './types.js';

type Content = proto.IMessage;

export function chatKind(jid: string): ChatKind {
  return jid.endsWith('@g.us') ? 'group' : 'dm';
}

/// Text in priority order; wrappers (ephemeral, view-once, doc-with-caption) are unwrapped first.
export function extractText(m: Content | null | undefined): string | null {
  const c = normalizeMessageContent(m);
  if (!c) return null;
  return (
    c.conversation ||
    c.extendedTextMessage?.text ||
    c.imageMessage?.caption ||
    c.videoMessage?.caption ||
    c.documentMessage?.caption ||
    null
  );
}

export function mediaKind(m: Content | null | undefined): string | null {
  const c = normalizeMessageContent(m);
  if (!c) return null;
  if (c.audioMessage) return 'audio';
  if (c.imageMessage) return 'image';
  if (c.videoMessage) return 'video';
  if (c.documentMessage) return 'document';
  if (c.stickerMessage) return 'sticker';
  if (c.locationMessage || c.liveLocationMessage) return 'location';
  if (c.contactMessage || c.contactsArrayMessage) return 'contact';
  return null;
}

function quotedIdOf(c: Content): string | null {
  for (const part of Object.values(c)) {
    if (part && typeof part === 'object' && 'contextInfo' in part) {
      const stanzaId = (part as { contextInfo?: proto.IContextInfo | null }).contextInfo?.stanzaId;
      if (stanzaId) return stanzaId;
    }
  }
  return null;
}

function senderOf(m: WAMessage, chatId: string): { senderJid: string | null; senderAltJid: string | null } {
  if (chatKind(chatId) === 'group') {
    return { senderJid: m.key.participant ?? null, senderAltJid: m.key.participantAlt ?? null };
  }
  if (m.key.fromMe) return { senderJid: null, senderAltJid: null };
  return { senderJid: chatId, senderAltJid: m.key.remoteJidAlt ?? null };
}

/// Status broadcasts and channels are not conversations wasap tracks.
export function skipChat(jid: string): boolean {
  return jid === 'status@broadcast' || jid.endsWith('@newsletter');
}

/// Keys that are never a message the user sees in the chat. Anything else that
/// has neither text nor a known media kind (polls, ptv, events, templates...)
/// is still stored as media kind 'other': dropping it would make an older
/// message look like the latest one (pending's latest_incoming, mark-read anchor).
const NOT_CONTENT = new Set([
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'reactionMessage',
  'encReactionMessage',
  'pollUpdateMessage',
  'encEventResponseMessage',
]);

function hasContent(c: Content): boolean {
  return Object.entries(c).some(([k, v]) => v !== null && v !== undefined && !NOT_CONTENT.has(k));
}

/// Maps one Baileys message to zero or more domain events. Reactions, poll and
/// event votes, key distribution and non-edit/revoke protocol messages produce
/// nothing; unknown content types become mediaKind 'other'.
export function toWaEvents(m: WAMessage): WaEvent[] {
  const chatId = m.key.remoteJid;
  const waId = m.key.id;
  if (!chatId || !waId || skipChat(chatId)) return [];
  const ts = toNumber(m.messageTimestamp);
  const content = normalizeMessageContent(m.message);
  if (!content) return [];

  const proto_ = content.protocolMessage;
  if (proto_) {
    const targetId = proto_.key?.id;
    if (!targetId) return [];
    if (proto_.type === proto.Message.ProtocolMessage.Type.REVOKE) return [{ kind: 'revoke', chatId, waId: targetId, ts }];
    if (proto_.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT) {
      const text = extractText(proto_.editedMessage);
      return text === null ? [] : [{ kind: 'edit', chatId, waId: targetId, text, ts }];
    }
    return [];
  }
  if (content.reactionMessage || content.pollUpdateMessage || !hasContent(content)) return [];

  const text = extractText(content);
  const media = mediaKind(content) ?? (text === null ? 'other' : null);

  const message: WaMessage = {
    chatId,
    waId,
    fromMe: m.key.fromMe === true,
    ...senderOf(m, chatId),
    ts,
    text,
    mediaKind: media,
    quotedId: quotedIdOf(content),
  };
  return [{ kind: 'messages', messages: [message] }];
}

/// History carries WhatsApp's absolute unread count; live updates carry increments
/// (and -1 for "marked unread"), so the two must stay distinguishable downstream.
export function toWaChat(c: Partial<Chat> & { id: string }, source: 'history' | 'update'): WaChat {
  const unread: WaChat['unread'] =
    source === 'history'
      ? { kind: 'absolute', count: c.unreadCount ?? 0, markedUnread: c.markedAsUnread === true || c.unreadCount === -1 }
      : 'unreadCount' in c
        ? { kind: 'live', value: c.unreadCount ?? null }
        : null;
  return {
    id: c.id,
    kind: chatKind(c.id),
    title: c.name ?? c.displayName ?? null,
    unread,
    archived: c.archived ?? null,
    mutedUntil: 'muteEndTime' in c ? fromMuteMs(c.muteEndTime) : undefined,
  };
}

/// WhatsApp mute end times are epoch milliseconds, with -1 meaning "forever";
/// wasap stores seconds. 0/null mean unmuted.
export function fromMuteMs(ms: Parameters<typeof toNumber>[0]): number | null {
  if (ms === null || ms === undefined) return null;
  const n = toNumber(ms);
  if (n === -1) return -1;
  return n > 0 ? Math.floor(n / 1000) : null;
}

/// Inverse of `fromMuteMs` for `chatModify({ mute })`: null unmutes, -1 is forever.
export function toMuteMs(untilSec: number | null): number | null {
  if (untilSec === null) return null;
  return untilSec === -1 ? -1 : untilSec * 1000;
}

export function toContactPairs(contacts: Contact[]): { contacts: { jid: string; name: string }[]; aliases: { lid: string; pn: string }[] } {
  const named: { jid: string; name: string }[] = [];
  const aliases: { lid: string; pn: string }[] = [];
  for (const c of contacts) {
    const name = c.name ?? c.notify;
    if (name) named.push({ jid: c.id, name });
    const lid = c.lid ?? (c.id.endsWith('@lid') ? c.id : undefined);
    const pn = c.phoneNumber ?? (c.id.endsWith('@s.whatsapp.net') ? c.id : undefined);
    if (lid && pn) aliases.push({ lid, pn });
  }
  return { contacts: named, aliases };
}
