import { describe, expect, it } from 'vitest';
import type { ChatRow, MessageRow } from '../store/types.js';
import { formatChat, formatMessage } from './format.js';

const msg = (over: Partial<MessageRow>): MessageRow => ({
  seq: 1, chatId: '111@s.whatsapp.net', waId: 'A1', fromMe: false, senderJid: null, senderName: null, ts: 1700000000,
  text: 'hello', mediaKind: null, quotedId: null, sentViaWasap: false, editedAt: null, deletedAt: null, ...over,
});

const chat = (over: Partial<ChatRow>): ChatRow => ({
  id: '999-1@g.us', kind: 'group', title: 'Test', waJid: '999-1@g.us', unreadCount: 0, markedUnread: false, archived: false, waMutedUntil: null,
  watchLevel: 'normal', category: 'general', snoozeUntil: null, lastMsgTs: null, lastMsgFromMe: null, createdAt: 0, contactName: null, ...over,
});

describe('formatMessage', () => {
  it('renders an unsupported message type as [unsupported]', () => {
    expect(formatMessage(msg({ text: null, mediaKind: 'other' })).text).toBe('[unsupported]');
  });

  it('renders an audio-only message as [audio]', () => {
    const v = formatMessage(msg({ text: null, mediaKind: 'audio' }));
    expect(v.text).toBe('[audio]');
    expect(v.media).toBe('audio');
  });

  it('marks own messages and names group senders', () => {
    expect(formatMessage(msg({ fromMe: true })).from).toBe('me');
    expect(formatMessage(msg({ chatId: '999-1@g.us', senderJid: '222@lid', senderName: 'Test' })).from).toEqual({ jid: '222@lid', name: 'Test' });
  });

  it('flags edited and deleted messages', () => {
    const v = formatMessage(msg({ editedAt: 5, deletedAt: 6, text: null }));
    expect(v).toMatchObject({ edited: true, deleted: true, text: '[deleted]' });
  });
});

describe('formatChat', () => {
  it('uses the contact name when the chat has no title', () => {
    expect(formatChat(chat({ title: null, contactName: 'Alpha' }), 100).title).toBe('Alpha');
    expect(formatChat(chat({ title: 'Own', contactName: 'Alpha' }), 100).title).toBe('Own');
  });

  it('falls back to the phone number for a nameless DM, never for a lid or group', () => {
    const dm = (id: string): ChatRow => chat({ id, kind: 'dm', title: null, waJid: id });
    expect(formatChat(dm('5550001@s.whatsapp.net'), 100).title).toBe('+5550001');
    expect(formatChat(dm('5550001:3@s.whatsapp.net'), 100).title).toBe('+5550001');
    expect(formatChat(dm('222@lid'), 100).title).toBeNull();
    expect(formatChat(chat({ title: null }), 100).title).toBeNull();
  });

  it('formats a -1 mute as forever, never a 1969 date', () => {
    expect(formatChat(chat({ waMutedUntil: -1 }), 100).muted).toBe('forever');
  });

  it('formats a future mute as ISO and an expired or absent one as null', () => {
    expect(formatChat(chat({ waMutedUntil: 200 }), 100).muted).toBe('1970-01-01T00:03:20.000Z');
    expect(formatChat(chat({ waMutedUntil: 50 }), 100).muted).toBeNull();
    expect(formatChat(chat({}), 100).muted).toBeNull();
  });
});
