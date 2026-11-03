import { beforeEach, describe, expect, it } from 'vitest';
import { pendingReason } from '../domain/pending.js';
import { AliasesRepo } from '../store/aliases-repo.js';
import { ChatsRepo } from '../store/chats-repo.js';
import { ContactsRepo } from '../store/contacts-repo.js';
import { openDb, type Db } from '../store/db.js';
import type { ChatRow } from '../store/types.js';
import { MessagesRepo } from '../store/messages-repo.js';
import { FakeGateway } from '../testing/fake-gateway.js';
import type { WaChat, WaMessage } from '../whatsapp/types.js';
import { Sink } from './sink.js';

const PN = '111@s.whatsapp.net';
const LID = '222@lid';
const LID2 = '333@lid';
const PN2 = '444@s.whatsapp.net';
const GROUP = '999-1@g.us';

function wm(chatId: string, waId: string, ts: number, over: Partial<WaMessage> = {}): WaMessage {
  return { chatId, waId, fromMe: false, senderJid: null, senderAltJid: null, ts, text: 'hello', mediaKind: null, quotedId: null, ...over };
}

function wc(id: string, over: Partial<WaChat> = {}): WaChat {
  return { id, kind: 'dm', title: null, unread: null, archived: null, mutedUntil: undefined, ...over };
}

describe('Sink', () => {
  let db: Db;
  let chats: ChatsRepo;
  let messages: MessagesRepo;
  let aliases: AliasesRepo;
  let sink: Sink;
  let gw: FakeGateway;
  let clock: number;

  beforeEach(() => {
    db = openDb(':memory:');
    chats = new ChatsRepo(db, () => 'normal');
    messages = new MessagesRepo(db);
    aliases = new AliasesRepo(db);
    clock = 1000;
    sink = new Sink({ db, chats, messages, aliases, contacts: new ContactsRepo(db), now: () => clock });
    gw = new FakeGateway();
    gw.onEvent((e) => sink.apply(e));
  });

  const aliasRows = (): { alias: string; canonical: string }[] =>
    db.prepare('SELECT alias, canonical FROM jid_aliases').all() as { alias: string; canonical: string }[];

  function expectFlat(): void {
    const keys = new Set(aliasRows().map((r) => r.alias));
    for (const r of aliasRows()) expect(keys.has(r.canonical)).toBe(false);
  }

  it('merges a lid chat and a phone chat when the alias arrives', () => {
    gw.emit({ kind: 'messages', messages: [wm(LID, 'A', 1), wm(LID, 'B', 2)] });
    gw.emit({ kind: 'messages', messages: [wm(PN, 'C', 3)] });
    expect(chats.list({ limit: 10, offset: 0 })).toHaveLength(2);
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID, pn: PN }] });
    const list = chats.list({ limit: 10, offset: 0 });
    expect(list).toHaveLength(1);
    expect(messages.history(list[0]?.id ?? '', { limit: 10 })).toHaveLength(3);
    gw.emit({ kind: 'messages', messages: [wm(LID, 'D', 4)] });
    gw.emit({ kind: 'messages', messages: [wm(PN, 'E', 5)] });
    expect(chats.list({ limit: 10, offset: 0 })).toHaveLength(1);
    expect(messages.history(list[0]?.id ?? '', { limit: 10 })).toHaveLength(5);
    expectFlat();
  });

  it('keeps aliases flat when a third form or a second mapping arrives after a merge', () => {
    gw.emit({ kind: 'messages', messages: [wm(LID, 'A', 1)] });
    gw.emit({ kind: 'messages', messages: [wm(PN, 'B', 2)] });
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID, pn: PN }] });
    // second lid for the same phone number
    gw.emit({ kind: 'messages', messages: [wm(LID2, 'C', 3)] });
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID2, pn: PN }] });
    expectFlat();
    const canonical = aliases.resolve(LID);
    expect(aliases.resolve(LID2)).toBe(canonical);
    expect(aliases.resolve(PN)).toBe(canonical);
    expect(chats.list({ limit: 10, offset: 0 })).toHaveLength(1);
    expect(messages.history(canonical, { limit: 10 })).toHaveLength(3);
    // the lid learns a different phone number: the two identities collapse
    gw.emit({ kind: 'messages', messages: [wm(PN2, 'D', 4)] });
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID, pn: PN2 }] });
    expectFlat();
    const merged = aliases.resolve(LID);
    for (const j of [LID, LID2, PN, PN2]) expect(aliases.resolve(j)).toBe(merged);
    expect(chats.list({ limit: 10, offset: 0 })).toHaveLength(1);
    expect(messages.history(merged, { limit: 10 })).toHaveLength(4);
  });

  it('sender pairs form aliases and senders are stored canonical', () => {
    gw.emit({ kind: 'messages', messages: [wm(GROUP, 'A', 1, { senderJid: LID, senderAltJid: PN })] });
    expect(aliases.resolve(LID)).toBe(PN);
    gw.emit({ kind: 'messages', messages: [wm(GROUP, 'B', 2, { senderJid: LID })] });
    expect(messages.history(GROUP, { limit: 10 }).map((m) => m.senderJid)).toEqual([PN, PN]);
    expect(chats.get(GROUP)?.kind).toBe('group');
  });

  it('records the raw chat jid of the latest chat event as wa_jid', () => {
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID, pn: PN }] });
    gw.emit({ kind: 'chats', chats: [wc(PN)] });
    expect(chats.get(PN)?.waJid).toBe(PN);
    gw.emit({ kind: 'chats', chats: [wc(LID)] });
    expect(chats.get(PN)?.waJid).toBe(LID);
    // A message under the other form is not a chat-level event: wa_jid stays.
    gw.emit({ kind: 'messages', messages: [wm(PN, 'A', 1)] });
    expect(chats.get(PN)?.waJid).toBe(LID);
  });

  it('a chat first seen through a message gets the raw jid as wa_jid', () => {
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID, pn: PN }] });
    gw.emit({ kind: 'messages', messages: [wm(LID, 'A', 1)] });
    expect(chats.get(PN)?.waJid).toBe(LID);
  });

  it('keeps the raw sender jid next to the canonical one', () => {
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID, pn: PN }] });
    gw.emit({ kind: 'messages', messages: [wm(GROUP, 'A', 1, { senderJid: LID })] });
    expect(messages.history(GROUP, { limit: 1 })[0]).toMatchObject({ senderJid: PN, senderWaJid: LID });
    expect(messages.latestKey(GROUP)?.senderJid).toBe(LID);
  });

  it('ignores a sender pair that is not one lid and one phone jid', () => {
    gw.emit({ kind: 'messages', messages: [wm(GROUP, 'A', 1, { senderJid: LID, senderAltJid: LID2 })] });
    expect(aliasRows()).toHaveLength(0);
  });

  it('marked_unread from history survives a live update', () => {
    gw.emit({ kind: 'chats', chats: [wc(PN, { unread: { kind: 'absolute', count: -1, markedUnread: true } })] });
    gw.emit({ kind: 'messages', messages: [wm(PN, 'A', 5)] });
    gw.emit({ kind: 'chats', chats: [wc(PN, { unread: { kind: 'live', value: 1 } })] });
    expect(pendingReason(chats.get(PN) as ChatRow, 10)).toBe('marked_unread');
  });

  it('null title keeps the stored one; null archived and undefined mute are no info', () => {
    gw.emit({ kind: 'chats', chats: [wc(GROUP, { kind: 'group', title: 'Team', archived: true, mutedUntil: -1 })] });
    gw.emit({ kind: 'chats', chats: [wc(GROUP, { kind: 'group' })] });
    expect(chats.get(GROUP)).toMatchObject({ title: 'Team', archived: true, waMutedUntil: -1 });
    gw.emit({ kind: 'chats', chats: [wc(GROUP, { kind: 'group', archived: false, mutedUntil: null })] });
    expect(chats.get(GROUP)).toMatchObject({ archived: false, waMutedUntil: null });
    gw.emit({ kind: 'chats', chats: [wc(GROUP, { kind: 'group', mutedUntil: 5000 })] });
    expect(chats.get(GROUP)?.waMutedUntil).toBe(5000);
  });

  it('edit replaces text and revoke soft-deletes', () => {
    gw.emit({ kind: 'messages', messages: [wm(PN, 'A', 1), wm(PN, 'B', 2)] });
    gw.emit({ kind: 'edit', chatId: PN, waId: 'A', text: 'changed', ts: 9 });
    gw.emit({ kind: 'revoke', chatId: PN, waId: 'B', ts: 10 });
    const h = messages.history(PN, { limit: 10 });
    expect(h.find((m) => m.waId === 'A')).toMatchObject({ text: 'changed', editedAt: 9 });
    expect(h.find((m) => m.waId === 'B')).toMatchObject({ text: null, deletedAt: 10 });
  });

  it('edit and revoke resolve aliased chat ids', () => {
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID, pn: PN }] });
    gw.emit({ kind: 'messages', messages: [wm(LID, 'A', 1)] });
    gw.emit({ kind: 'edit', chatId: LID, waId: 'A', text: 'changed', ts: 9 });
    expect(messages.history(PN, { limit: 10 })[0]?.text).toBe('changed');
  });

  it('re-applying the same messages event is idempotent and stores sentViaWasap false', () => {
    const e = { kind: 'messages' as const, messages: [wm(PN, 'A', 1), wm(PN, 'B', 2)] };
    gw.emit(e);
    gw.emit(e);
    const h = messages.history(PN, { limit: 10 });
    expect(h).toHaveLength(2);
    expect(h.every((m) => !m.sentViaWasap)).toBe(true);
  });

  it('stores contacts under the raw and canonical jid', () => {
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID, pn: PN }] });
    gw.emit({ kind: 'contacts', contacts: [{ jid: LID, name: 'Someone' }] });
    const c = new ContactsRepo(db);
    expect(c.name(LID)).toBe('Someone');
    expect(c.name(PN)).toBe('Someone');
  });

  it('names a sender from its profile name, under every form, without overriding a saved contact', () => {
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID, pn: PN }] });
    gw.emit({ kind: 'messages', messages: [wm(LID, 'a', 1, { senderJid: LID, pushName: 'Profile' })] });
    const c = new ContactsRepo(db);
    expect([c.name(LID), c.name(PN)]).toEqual(['Profile', 'Profile']);
    gw.emit({ kind: 'contacts', contacts: [{ jid: PN, name: 'Saved' }] });
    gw.emit({ kind: 'messages', messages: [wm(PN, 'b', 2, { senderJid: PN, pushName: 'Profile 2' })] });
    expect(c.name(PN)).toBe('Saved');
  });

  it('tracks connection state and last event time', () => {
    expect(sink.connection()).toBe('connecting');
    expect(sink.lastEventAt()).toBeNull();
    gw.emit({ kind: 'connection', state: 'open' });
    expect(sink.connection()).toBe('open');
    expect(sink.lastEventAt()).toBeNull();
    clock = 2000;
    gw.emit({ kind: 'messages', messages: [wm(PN, 'A', 1)] });
    expect(sink.lastEventAt()).toBe(2000);
    clock = 3000;
    gw.emit({ kind: 'connection', state: 'reconnecting' });
    expect(sink.lastEventAt()).toBe(2000);
  });

  it('rolls back and rethrows when applying fails', () => {
    const boom = new Sink({
      db, chats, aliases, contacts: new ContactsRepo(db), now: () => 1,
      messages: { ...messages, insertMany: () => { throw new Error('boom'); } } as unknown as MessagesRepo,
    });
    expect(() => boom.apply({ kind: 'messages', messages: [wm(PN, 'A', 1)] })).toThrow('boom');
    expect(chats.get(PN)).toBeNull();
    expect(boom.lastEventAt()).toBeNull();
  });

  it('carries a contact name that arrived before the alias to the canonical sender', () => {
    gw.emit({ kind: 'contacts', contacts: [{ jid: LID, name: 'Someone' }] });
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID, pn: PN }] });
    gw.emit({ kind: 'messages', messages: [wm(GROUP, 'A', 1, { senderJid: LID })] });
    expect(messages.history(GROUP, { limit: 10 })[0]).toMatchObject({ senderJid: PN, senderName: 'Someone' });
  });

  it('does not overwrite an existing winner name when merging contacts', () => {
    gw.emit({ kind: 'contacts', contacts: [{ jid: LID, name: 'Lid Name' }, { jid: PN, name: 'Saved Name' }] });
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID, pn: PN }] });
    expect(new ContactsRepo(db).name(PN)).toBe('Saved Name');
  });

  it('rewrites stored sender ids to the winner on merge', () => {
    gw.emit({ kind: 'messages', messages: [wm(GROUP, 'A', 1, { senderJid: LID }), wm(GROUP, 'B', 2, { senderJid: PN })] });
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID, pn: PN }] });
    expect(messages.history(GROUP, { limit: 10 }).map((m) => m.senderJid)).toEqual([PN, PN]);
  });
});
