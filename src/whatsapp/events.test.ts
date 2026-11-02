import { DisconnectReason, proto } from '@whiskeysockets/baileys';
import { describe, expect, it } from 'vitest';
import { DM_JID, GROUP_JID, LID_JID, waMessage } from '../testing/fixtures.js';
import { closeReason, mapChats, mapContacts, mapGroups, mapHistorySet, mapMessages } from './events.js';
import type { WaEvent } from './types.js';

const PN_2 = '333@s.whatsapp.net';
const revoke = (id: string) =>
  waMessage({
    id: 'R1',
    message: { protocolMessage: { type: proto.Message.ProtocolMessage.Type.REVOKE, key: { id } } },
  });

function kinds(events: WaEvent[]): string[] {
  return events.map((e) => e.kind);
}

describe('mapMessages', () => {
  it('merges plain messages into one event and keeps edits/revokes separate', () => {
    const events = mapMessages([waMessage({ id: 'A' }), revoke('A'), waMessage({ id: 'B' })]);
    expect(kinds(events)).toEqual(['messages', 'revoke']);
    const first = events[0];
    expect(first?.kind === 'messages' && first.messages.map((m) => m.waId)).toEqual(['A', 'B']);
  });

  it('returns nothing for an empty or fully skipped batch', () => {
    expect(mapMessages([])).toEqual([]);
    expect(mapMessages([waMessage({ chat: 'status@broadcast' })])).toEqual([]);
  });
});

describe('mapHistorySet', () => {
  it('emits aliases, contacts, chats (history source) and messages', () => {
    const events = mapHistorySet({
      chats: [{ id: DM_JID, unreadCount: 2 }],
      contacts: [{ id: DM_JID, notify: 'Fake Name' }],
      messages: [waMessage({ id: 'A' })],
      lidPnMappings: [{ lid: LID_JID, pn: PN_2 }],
    });
    expect(kinds(events)).toEqual(['aliases', 'contacts', 'chats', 'messages']);
    expect(events[0]).toEqual({ kind: 'aliases', pairs: [{ lid: LID_JID, pn: PN_2 }] });
    expect(events[1]).toEqual({ kind: 'contacts', contacts: [{ jid: DM_JID, name: 'Fake Name' }] });
    const chats = events[2];
    expect(chats?.kind === 'chats' && chats.chats[0]?.unread).toEqual({ kind: 'absolute', count: 2, markedUnread: false });
  });

  it('falls back to chat lidJid/pnJid when lidPnMappings is absent', () => {
    const events = mapHistorySet({
      chats: [
        { id: LID_JID, pnJid: PN_2 },
        { id: DM_JID, lidJid: '444@lid' },
      ],
      contacts: [],
      messages: [],
    });
    expect(events.find((e) => e.kind === 'aliases')).toEqual({
      kind: 'aliases',
      pairs: [
        { lid: LID_JID, pn: PN_2 },
        { lid: '444@lid', pn: DM_JID },
      ],
    });
  });

  it('deduplicates alias pairs from mappings and contacts', () => {
    const events = mapHistorySet({
      chats: [],
      contacts: [{ id: LID_JID, phoneNumber: PN_2 }],
      messages: [],
      lidPnMappings: [{ lid: LID_JID, pn: PN_2 }],
    });
    expect(events).toEqual([{ kind: 'aliases', pairs: [{ lid: LID_JID, pn: PN_2 }] }]);
  });

  it('drops status and newsletter chats', () => {
    const events = mapHistorySet({
      chats: [{ id: 'status@broadcast' }, { id: '123@newsletter' }],
      contacts: [],
      messages: [],
    });
    expect(events).toEqual([]);
  });
});

describe('mapChats', () => {
  it('maps upserts with the history source', () => {
    const [e] = mapChats([{ id: GROUP_JID, unreadCount: 0 }], 'history');
    expect(e?.kind === 'chats' && e.chats[0]?.unread).toEqual({ kind: 'absolute', count: 0, markedUnread: false });
  });

  it('maps updates with the update source and skips entries without an id', () => {
    const [e, ...rest] = mapChats([{ id: DM_JID, unreadCount: 1 }, { unreadCount: 3 }], 'update');
    expect(rest).toEqual([]);
    expect(e?.kind === 'chats' && e.chats.map((c) => c.unread)).toEqual([{ kind: 'live', value: 1 }]);
  });

  it('returns nothing for an empty batch', () => {
    expect(mapChats([], 'update')).toEqual([]);
  });
});

describe('mapContacts', () => {
  it('keeps name/notify and drops contacts without one or without an id', () => {
    const events = mapContacts([{ id: DM_JID, name: 'Saved' }, { id: PN_2 }, { notify: 'No id' }]);
    expect(events).toEqual([{ kind: 'contacts', contacts: [{ jid: DM_JID, name: 'Saved' }] }]);
  });

  it('also emits alias pairs the contacts carry', () => {
    const events = mapContacts([{ id: LID_JID, phoneNumber: PN_2 }]);
    expect(events).toEqual([{ kind: 'aliases', pairs: [{ lid: LID_JID, pn: PN_2 }] }]);
  });
});

describe('mapGroups', () => {
  it('emits group titles with no unread, archive or mute info', () => {
    const events = mapGroups({ [GROUP_JID]: { id: GROUP_JID, subject: 'Fake Group' } });
    expect(events).toEqual([
      {
        kind: 'chats',
        chats: [{ id: GROUP_JID, kind: 'group', title: 'Fake Group', unread: null, archived: null, mutedUntil: undefined }],
      },
    ]);
  });

  it('returns nothing when there are no groups', () => {
    expect(mapGroups({})).toEqual([]);
  });
});

describe('closeReason', () => {
  const boom = (statusCode: number) => Object.assign(new Error('closed'), { output: { statusCode } });

  it('classifies loggedOut', () => {
    expect(closeReason(boom(DisconnectReason.loggedOut))).toBe('logged_out');
  });
  it('classifies restartRequired', () => {
    expect(closeReason(boom(DisconnectReason.restartRequired))).toBe('restart_required');
  });
  it('treats everything else, including missing errors, as other', () => {
    expect(closeReason(boom(DisconnectReason.connectionLost))).toBe('other');
    expect(closeReason(undefined)).toBe('other');
    expect(closeReason(new Error('plain'))).toBe('other');
  });
});
