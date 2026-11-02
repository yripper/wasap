import { proto } from '@whiskeysockets/baileys';
import { describe, expect, it } from 'vitest';
import { DM_JID, GROUP_JID, LID_JID, waMessage } from '../testing/fixtures.js';
import { chatKind, extractText, fromMuteMs, mediaKind, toContactPairs, toMuteMs, toWaChat, toWaEvents } from './adapt.js';
import type { WaEvent } from './types.js';

const T = proto.Message.ProtocolMessage.Type;

describe('extractText', () => {
  it('reads each field', () => {
    expect(extractText({ conversation: 'hello' })).toBe('hello');
    expect(extractText({ extendedTextMessage: { text: 'ext' } })).toBe('ext');
    expect(extractText({ imageMessage: { caption: 'img' } })).toBe('img');
    expect(extractText({ videoMessage: { caption: 'vid' } })).toBe('vid');
    expect(extractText({ documentMessage: { caption: 'doc' } })).toBe('doc');
  });
  it('prefers conversation over extended text', () => {
    expect(extractText({ conversation: 'a', extendedTextMessage: { text: 'b' } })).toBe('a');
  });
  it('unwraps ephemeral, view-once and document-with-caption', () => {
    expect(extractText({ ephemeralMessage: { message: { conversation: 'eph' } } })).toBe('eph');
    expect(extractText({ viewOnceMessage: { message: { imageMessage: { caption: 'once' } } } })).toBe('once');
    expect(extractText({ viewOnceMessageV2: { message: { imageMessage: { caption: 'v2' } } } })).toBe('v2');
    expect(extractText({ documentWithCaptionMessage: { message: { documentMessage: { caption: 'dwc' } } } })).toBe('dwc');
  });
  it('returns null for empty/absent content', () => {
    expect(extractText(null)).toBeNull();
    expect(extractText({ audioMessage: {} })).toBeNull();
  });
});

describe('mediaKind', () => {
  it('classifies kinds', () => {
    expect(mediaKind({ audioMessage: {} })).toBe('audio');
    expect(mediaKind({ imageMessage: {} })).toBe('image');
    expect(mediaKind({ videoMessage: {} })).toBe('video');
    expect(mediaKind({ documentMessage: {} })).toBe('document');
    expect(mediaKind({ stickerMessage: {} })).toBe('sticker');
    expect(mediaKind({ locationMessage: {} })).toBe('location');
    expect(mediaKind({ contactMessage: {} })).toBe('contact');
    expect(mediaKind({ conversation: 'hello' })).toBeNull();
  });
});

describe('toWaEvents', () => {
  it('maps a DM text message', () => {
    const [e] = toWaEvents(waMessage({}));
    expect(e).toEqual({
      kind: 'messages',
      messages: [
        { chatId: DM_JID, waId: 'M1', fromMe: false, senderJid: DM_JID, senderAltJid: null, ts: 1700000000, text: 'hello', mediaKind: null, quotedId: null },
      ],
    });
  });
  it('keeps the lid chat id and exposes the alt jid', () => {
    const [e] = toWaEvents(waMessage({ chat: LID_JID, remoteJidAlt: DM_JID }));
    expect(e).toMatchObject({ kind: 'messages', messages: [{ chatId: LID_JID, senderJid: LID_JID, senderAltJid: DM_JID }] });
  });
  it('uses the participant as sender in groups', () => {
    const [e] = toWaEvents(waMessage({ chat: GROUP_JID, participant: LID_JID, participantAlt: DM_JID }));
    expect(e).toMatchObject({ messages: [{ senderJid: LID_JID, senderAltJid: DM_JID }] });
  });
  it('has no sender for own DM messages', () => {
    const [e] = toWaEvents(waMessage({ fromMe: true }));
    expect(e).toMatchObject({ messages: [{ fromMe: true, senderJid: null }] });
  });
  it('captures the quoted id and media kind', () => {
    const [e] = toWaEvents(waMessage({ message: { extendedTextMessage: { text: 'r', contextInfo: { stanzaId: 'Q1' } } } }));
    expect(e).toMatchObject({ messages: [{ quotedId: 'Q1' }] });
    const [m] = toWaEvents(waMessage({ message: { audioMessage: {} } }));
    expect(m).toMatchObject({ messages: [{ text: null, mediaKind: 'audio' }] });
  });
  it('ignores noise', () => {
    expect(toWaEvents(waMessage({ message: { reactionMessage: { text: '+' } } }))).toEqual([]);
    expect(toWaEvents(waMessage({ message: { senderKeyDistributionMessage: { groupId: GROUP_JID } } }))).toEqual([]);
    expect(toWaEvents(waMessage({ chat: 'status@broadcast' }))).toEqual([]);
    expect(toWaEvents(waMessage({ chat: '555@newsletter' }))).toEqual([]);
    expect(toWaEvents(waMessage({ message: null }))).toEqual([]);
    expect(toWaEvents(waMessage({ message: { pollCreationMessage: {} } }))).toEqual([]);
    expect(toWaEvents(waMessage({ message: { protocolMessage: { type: T.EPHEMERAL_SETTING } } }))).toEqual([]);
  });
  it('maps an edit using the target key id', () => {
    const msg = { protocolMessage: { type: T.MESSAGE_EDIT, key: { id: 'M0' }, editedMessage: { conversation: 'fixed' } } };
    expect(toWaEvents(waMessage({ id: 'E1', message: msg, ts: 1700000050 }))).toEqual<WaEvent[]>([
      { kind: 'edit', chatId: DM_JID, waId: 'M0', text: 'fixed', ts: 1700000050 },
    ]);
  });
  it('maps a revoke using the target key id', () => {
    const msg = { protocolMessage: { type: T.REVOKE, key: { id: 'M0' } } };
    expect(toWaEvents(waMessage({ id: 'R1', message: msg, ts: 1700000060 }))).toEqual<WaEvent[]>([
      { kind: 'revoke', chatId: DM_JID, waId: 'M0', ts: 1700000060 },
    ]);
  });
});

describe('toWaChat', () => {
  it('history: -1 is marked unread', () => {
    expect(toWaChat({ id: DM_JID, unreadCount: -1 }, 'history').unread).toEqual({ kind: 'absolute', count: -1, markedUnread: true });
  });
  it('history: markedAsUnread flag and default count', () => {
    expect(toWaChat({ id: DM_JID, markedAsUnread: true }, 'history').unread).toEqual({ kind: 'absolute', count: 0, markedUnread: true });
  });
  it('update: live value when key present, null otherwise', () => {
    expect(toWaChat({ id: DM_JID, unreadCount: 2 }, 'update').unread).toEqual({ kind: 'live', value: 2 });
    expect(toWaChat({ id: DM_JID, unreadCount: null }, 'update').unread).toEqual({ kind: 'live', value: null });
    expect(toWaChat({ id: DM_JID }, 'update').unread).toBeNull();
  });
  it('maps kind, title, archive and mute', () => {
    expect(toWaChat({ id: GROUP_JID, name: 'team', archived: true, muteEndTime: 1700000500999 }, 'history')).toMatchObject({
      kind: 'group',
      title: 'team',
      archived: true,
      mutedUntil: 1700000500,
    });
    expect(toWaChat({ id: DM_JID, muteEndTime: null }, 'update').mutedUntil).toBeNull();
    expect(toWaChat({ id: DM_JID, muteEndTime: 0 }, 'update').mutedUntil).toBeNull();
    expect(toWaChat({ id: DM_JID, muteEndTime: -1 }, 'update').mutedUntil).toBe(-1);
    expect(toWaChat({ id: DM_JID }, 'update')).toMatchObject({ title: null, archived: null, mutedUntil: undefined });
  });
});

describe('chatKind / toContactPairs', () => {
  it('detects groups', () => {
    expect(chatKind(GROUP_JID)).toBe('group');
    expect(chatKind(DM_JID)).toBe('dm');
  });
  it('extracts names and lid/pn pairs', () => {
    expect(toContactPairs([{ id: LID_JID, phoneNumber: DM_JID, name: 'Ann' }, { id: DM_JID }])).toEqual({
      contacts: [{ jid: LID_JID, name: 'Ann' }],
      aliases: [{ lid: LID_JID, pn: DM_JID }],
    });
  });
});

describe('mute units (ms on the wire, seconds in wasap)', () => {
  it('fromMuteMs floors ms to seconds and keeps -1 as forever', () => {
    expect(fromMuteMs(1700000500999)).toBe(1700000500);
    expect(fromMuteMs(-1)).toBe(-1);
    expect(fromMuteMs(0)).toBeNull();
    expect(fromMuteMs(null)).toBeNull();
    expect(fromMuteMs(undefined)).toBeNull();
  });
  it('toMuteMs: null unmutes, -1 stays forever, seconds become ms', () => {
    expect(toMuteMs(null)).toBeNull();
    expect(toMuteMs(-1)).toBe(-1);
    expect(toMuteMs(1700000500)).toBe(1700000500000);
  });
});
