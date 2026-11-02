import { beforeEach, describe, expect, it } from 'vitest';
import { makeActionDeps } from '../testing/action-deps.js';
import { leaveGroup } from './destructive.js';
import { markRead, sendMessage } from './messaging.js';
import { archiveChats, muteChat } from './organize.js';

const PN = '111@s.whatsapp.net';
const LID = '222@lid';
const GROUP = '999-1@g.us';
const SENDER_PN = '333@s.whatsapp.net';
const SENDER_LID = '444@lid';

let t: ReturnType<typeof makeActionDeps>;

// WhatsApp keys app-state patches by the JID it uses for the chat, which can be
// the @lid even when wasap's canonical id is the phone number.
beforeEach(() => {
  t = makeActionDeps();
  t.chats.upsert({ id: PN, kind: 'dm', waJid: LID }, 0);
  t.messages.insertMany([{ chatId: PN, waId: 'IN1', fromMe: false, senderJid: PN, senderWaJid: LID, ts: 100, text: 'hello', mediaKind: null, quotedId: null, sentViaWasap: false }]);
  t.chats.upsert({ id: GROUP, kind: 'group', waJid: GROUP }, 0);
  t.messages.insertMany([
    { chatId: GROUP, waId: 'G1', fromMe: false, senderJid: SENDER_PN, senderWaJid: SENDER_LID, ts: 50, text: 'hello', mediaKind: null, quotedId: null, sentViaWasap: false },
  ]);
});

describe('actions address WhatsApp by the chat wa_jid', () => {
  it('markRead uses wa_jid', async () => {
    await markRead(t.deps, PN);
    expect(t.gateway.callsTo('markRead')).toEqual([[LID, { waId: 'IN1', fromMe: false, ts: 100, senderJid: LID }]]);
  });

  it('sendMessage sends to wa_jid and stores under the canonical id', async () => {
    await sendMessage(t.deps, PN, 'hello');
    expect(t.gateway.callsTo('sendText')[0]?.[0]).toBe(LID);
    expect(t.gateway.callsTo('markRead')[0]?.[0]).toBe(LID);
    expect(t.messages.history(PN, { limit: 1 })[0]?.waId).toBe('SENT1');
  });

  it('archive and mute use wa_jid', async () => {
    await archiveChats(t.deps, [PN]);
    await muteChat(t.deps, PN, null);
    expect(t.gateway.callsTo('setArchived')[0]?.[0]).toBe(LID);
    expect(t.gateway.callsTo('setMuted')[0]?.[0]).toBe(LID);
  });

  it('group keys carry the raw sender jid as received', async () => {
    await markRead(t.deps, GROUP);
    expect(t.gateway.callsTo('markRead')).toEqual([[GROUP, { waId: 'G1', fromMe: false, ts: 50, senderJid: SENDER_LID }]]);
  });

  it('leaveGroup uses wa_jid', async () => {
    await leaveGroup(t.deps, GROUP);
    expect(t.gateway.callsTo('leaveGroup')).toEqual([[GROUP]]);
  });
});
