import { beforeEach, describe, expect, it } from 'vitest';
import { makeActionDeps } from '../testing/action-deps.js';
import { archiveChats, muteChat, unarchiveChats, unmuteChat } from './organize.js';

const A = '111@s.whatsapp.net';
const B = '444@s.whatsapp.net';
const EMPTY = '555@s.whatsapp.net';

let t: ReturnType<typeof makeActionDeps>;

beforeEach(() => {
  t = makeActionDeps();
  for (const [id, ts] of [[A, 10], [B, 20]] as const) {
    t.chats.upsert({ id, kind: 'dm' }, 0);
    t.messages.insertMany([{ chatId: id, waId: `M-${id}`, fromMe: false, senderJid: id, ts, text: 'hello', mediaKind: null, quotedId: null, sentViaWasap: false }]);
  }
  t.chats.upsert({ id: EMPTY, kind: 'dm' }, 0);
});

describe('archive / unarchive', () => {
  it('archives each chat anchored on its latest message and updates the store', async () => {
    await archiveChats(t.deps, [A, B]);
    expect(t.gateway.callsTo('setArchived')).toEqual([
      [A, true, { waId: `M-${A}`, fromMe: false, ts: 10, senderJid: A }],
      [B, true, { waId: `M-${B}`, fromMe: false, ts: 20, senderJid: B }],
    ]);
    expect(t.chats.get(A)?.archived).toBe(true);
    await unarchiveChats(t.deps, [A]);
    expect(t.gateway.callsTo('setArchived')[2]?.[1]).toBe(false);
    expect(t.chats.get(A)?.archived).toBe(false);
  });

  it('rejects the whole batch before any call when a chat has no messages or is unknown', async () => {
    await expect(archiveChats(t.deps, [A, EMPTY])).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(archiveChats(t.deps, [A, '666@s.whatsapp.net'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(t.gateway.callsTo('setArchived')).toHaveLength(0);
    expect(t.chats.get(A)?.archived).toBe(false);
  });

  it('does not touch the store when WhatsApp fails', async () => {
    t.gateway.failOn.set('setArchived', new Error('boom'));
    await expect(archiveChats(t.deps, [A])).rejects.toThrow('boom');
    expect(t.chats.get(A)?.archived).toBe(false);
    expect(t.audit.recent(1)[0]).toMatchObject({ action: 'archive_chat', chatId: A, outcome: 'error' });
  });
});

describe('mute / unmute', () => {
  it('stores -1 for forever and the given timestamp otherwise', async () => {
    await muteChat(t.deps, A, null);
    expect(t.gateway.callsTo('setMuted')).toEqual([[A, -1]]);
    expect(t.chats.get(A)?.waMutedUntil).toBe(-1);
    await muteChat(t.deps, A, 5000);
    expect(t.gateway.callsTo('setMuted')[1]).toEqual([A, 5000]);
    expect(t.chats.get(A)?.waMutedUntil).toBe(5000);
  });

  it('unmutes with null', async () => {
    await muteChat(t.deps, A, null);
    await unmuteChat(t.deps, A);
    expect(t.gateway.callsTo('setMuted')[1]).toEqual([A, null]);
    expect(t.chats.get(A)?.waMutedUntil).toBeNull();
  });

  it('rejects unknown chats', async () => {
    await expect(muteChat(t.deps, '666@s.whatsapp.net', null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(unmuteChat(t.deps, '666@s.whatsapp.net')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
