import { beforeEach, describe, expect, it } from 'vitest';
import { makeActionDeps } from '../testing/action-deps.js';
import { sendMessage } from './messaging.js';
import { normalizeRecipient } from './recipient.js';

const KNOWN = '111@s.whatsapp.net';
const KNOWN_LID = '222@lid';
const GROUP = '999-1@g.us';
const NEW = '1110000001@s.whatsapp.net';

let t: ReturnType<typeof makeActionDeps>;

beforeEach(() => {
  t = makeActionDeps();
  t.chats.upsert({ id: KNOWN, kind: 'dm' }, 0);
  t.chats.upsert({ id: GROUP, kind: 'group' }, 0);
});

describe('normalizeRecipient', () => {
  it.each([
    ['+111 000 0001', NEW],
    ['1110000001', NEW],
    ['+111-(000)-0001', NEW],
    ['  111.000.0001 ', NEW],
    [NEW, NEW],
    [GROUP, GROUP],
    [KNOWN_LID, KNOWN_LID],
  ])('%s -> %s', (input, jid) => {
    expect(normalizeRecipient(input)).toBe(jid);
  });

  it.each(['hello', '+111 abcd', '123', '1234567890123456', '++1110000001'])('rejects %s', (input) => {
    expect(() => normalizeRecipient(input)).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });
});

describe('sendMessage to a recipient', () => {
  it('sends to a known chat without asking WhatsApp whether it exists', async () => {
    const res = await sendMessage(t.deps, KNOWN, 'hello');
    expect(res).toEqual({ chatId: KNOWN, waId: 'SENT1', markedRead: false });
    expect(t.gateway.callsTo('onWhatsApp')).toHaveLength(0);
    expect(t.gateway.callsTo('sendText')).toEqual([[KNOWN, 'hello', undefined]]);
  });

  it('finds a known chat by phone number', async () => {
    t.chats.upsert({ id: '1111111@s.whatsapp.net', kind: 'dm' }, 0);
    const res = await sendMessage(t.deps, '+111 1111', 'hello');
    expect(res.chatId).toBe('1111111@s.whatsapp.net');
    expect(t.gateway.callsTo('onWhatsApp')).toHaveLength(0);
  });

  it('finds a known chat stored under its lid when given the phone number', async () => {
    t.chats.upsert({ id: KNOWN_LID, kind: 'dm' }, 0);
    t.deps.aliases.add('3333333@s.whatsapp.net', KNOWN_LID);
    const res = await sendMessage(t.deps, '3333333', 'hello');
    expect(res.chatId).toBe(KNOWN_LID);
    expect(t.gateway.callsTo('sendText')[0]?.[0]).toBe(KNOWN_LID);
    expect(t.gateway.callsTo('onWhatsApp')).toHaveLength(0);
  });

  it('sends to a new number on WhatsApp and stores the chat', async () => {
    t.gateway.onWhatsAppNumbers.add(NEW);
    const res = await sendMessage(t.deps, '+111 000 0001', 'hello');
    expect(res).toEqual({ chatId: NEW, waId: 'SENT1', markedRead: false });
    expect(t.gateway.callsTo('onWhatsApp')).toEqual([[NEW]]);
    expect(t.gateway.callsTo('sendText')).toEqual([[NEW, 'hello', undefined]]);
    expect(t.gateway.callsTo('markRead')).toHaveLength(0);
    expect(t.chats.get(NEW)).toMatchObject({ id: NEW, kind: 'dm', waJid: NEW, lastMsgFromMe: true });
    expect(t.messages.history(NEW, { limit: 5 })).toMatchObject([{ waId: 'SENT1', fromMe: true, text: 'hello', sentViaWasap: true }]);
    expect(t.audit.recent(5).map((a) => [a.action, a.chatId, a.outcome])).toContainEqual(['send_message', NEW, 'ok']);
  });

  it('keeps a chat the live echo already created', async () => {
    t.gateway.onWhatsAppNumbers.add(NEW);
    // The echo of our own message can land before sendText resolves.
    t.chats.upsert({ id: NEW, kind: 'dm', waJid: '555@lid' }, 0);
    await sendMessage(t.deps, NEW, 'hello');
    expect(t.chats.get(NEW)?.waJid).toBe('555@lid');
  });

  it('rejects a number that is not on WhatsApp without sending or storing', async () => {
    await expect(sendMessage(t.deps, '+111 000 0001', 'hello')).rejects.toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('not on WhatsApp') });
    expect(t.gateway.callsTo('onWhatsApp')).toEqual([[NEW]]);
    expect(t.gateway.callsTo('sendText')).toHaveLength(0);
    expect(t.chats.get(NEW)).toBeNull();
  });

  it('rejects an unknown group without asking WhatsApp', async () => {
    await expect(sendMessage(t.deps, '888-1@g.us', 'hello')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(t.gateway.callsTo('onWhatsApp')).toHaveLength(0);
    expect(t.gateway.callsTo('sendText')).toHaveLength(0);
  });

  it('rejects an unknown lid without asking WhatsApp', async () => {
    await expect(sendMessage(t.deps, '777@lid', 'hello')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(t.gateway.callsTo('onWhatsApp')).toHaveLength(0);
  });

  it('rejects quoting in a new chat before asking WhatsApp', async () => {
    t.gateway.onWhatsAppNumbers.add(NEW);
    await expect(sendMessage(t.deps, NEW, 'hello', 'X1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(t.gateway.callsTo('onWhatsApp')).toHaveLength(0);
  });

  it('rate limits lookups of new numbers like sends', async () => {
    await expect(sendMessage(t.deps, NEW, 'one')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(sendMessage(t.deps, NEW, 'two')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(t.gateway.callsTo('onWhatsApp')).toHaveLength(1);
  });

  it('surfaces a failed WhatsApp lookup without sending', async () => {
    t.gateway.failOn.set('onWhatsApp', new Error('boom'));
    await expect(sendMessage(t.deps, NEW, 'hello')).rejects.toThrow('boom');
    expect(t.gateway.callsTo('sendText')).toHaveLength(0);
  });
});
