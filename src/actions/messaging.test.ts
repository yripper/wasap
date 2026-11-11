import { beforeEach, describe, expect, it } from 'vitest';
import { makeActionDeps } from '../testing/action-deps.js';
import { markRead, sendMessage } from './messaging.js';

const DM = '111@s.whatsapp.net';
const DM2 = '444@s.whatsapp.net';

let t: ReturnType<typeof makeActionDeps>;

function seedIncoming(chatId: string, waId: string, ts: number): void {
  t.messages.insertMany([{ chatId, waId, fromMe: false, senderJid: chatId, ts, text: 'hi there', mediaKind: null, quotedId: null, sentViaWasap: false }]);
}

beforeEach(() => {
  t = makeActionDeps({ sendsPerMinute: 2 });
  t.chats.upsert({ id: DM, kind: 'dm' }, 0);
  t.chats.upsert({ id: DM2, kind: 'dm' }, 0);
  seedIncoming(DM, 'IN1', 100);
  t.chats.applyUnread(DM, { kind: 'absolute', count: 3, markedUnread: false });
});

describe('sendMessage', () => {
  it('sends, marks the prior latest message read, stores the row and clears unread', async () => {
    const res = await sendMessage(t.deps, DM, 'hello');
    expect(res).toEqual({ chatId: DM, waId: 'SENT1', markedRead: true });
    expect(t.gateway.callsTo('sendText')).toEqual([[DM, 'hello', undefined]]);
    expect(t.gateway.callsTo('markRead')).toEqual([[DM, { waId: 'IN1', fromMe: false, ts: 100, senderJid: DM }]]);
    expect(t.messages.history(DM, { limit: 1 })[0]).toMatchObject({ waId: 'SENT1', fromMe: true, senderJid: null, text: 'hello', sentViaWasap: true });
    expect(t.chats.get(DM)).toMatchObject({ unreadCount: 0, markedUnread: false, lastMsgFromMe: true });
  });

  it('keeps the send when markRead fails', async () => {
    t.gateway.failOn.set('markRead', new Error('boom'));
    const res = await sendMessage(t.deps, DM, 'hello');
    expect(res.markedRead).toBe(false);
    expect(t.messages.history(DM, { limit: 1 })[0]?.waId).toBe('SENT1');
    expect(t.chats.get(DM)?.unreadCount).toBe(3);
  });

  it('skips markRead for a chat with no prior messages', async () => {
    const res = await sendMessage(t.deps, DM2, 'hello');
    expect(res.markedRead).toBe(false);
    expect(t.gateway.callsTo('markRead')).toHaveLength(0);
    expect(t.messages.history(DM2, { limit: 5 })).toHaveLength(1);
  });

  it('quotes a stored message and rejects an unknown one', async () => {
    await sendMessage(t.deps, DM, 'hello', 'IN1');
    expect(t.gateway.callsTo('sendText')[0]?.[2]).toEqual({ waId: 'IN1', fromMe: false, ts: 100, senderJid: DM });
    t.clock.ms += 2000;
    await expect(sendMessage(t.deps, DM, 'hello', 'NOPE')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(t.gateway.callsTo('sendText')).toHaveLength(1);
  });

  it('rejects unknown chats before calling WhatsApp', async () => {
    await expect(sendMessage(t.deps, '555@s.whatsapp.net', 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(t.gateway.callsTo('sendText')).toHaveLength(0);
  });

  it('enforces the per-chat gap', async () => {
    await sendMessage(t.deps, DM, 'a');
    await expect(sendMessage(t.deps, DM, 'b')).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSec: 1 });
  });

  it('enforces the global send limit', async () => {
    await sendMessage(t.deps, DM, 'a');
    await sendMessage(t.deps, DM2, 'b');
    t.clock.ms += 2000;
    await expect(sendMessage(t.deps, DM, 'c')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('audits metadata only and records failures', async () => {
    await sendMessage(t.deps, DM, 'secret words');
    t.clock.ms += 2000;
    t.gateway.failOn.set('sendText', new Error('boom'));
    await expect(sendMessage(t.deps, DM, 'more secret')).rejects.toThrow('boom');
    const rows = t.audit.recent(10);
    expect(rows.map((r) => [r.action, r.outcome])).toContainEqual(['send_message', 'error']);
    expect(JSON.stringify(rows)).not.toMatch(/secret/);
  });

  it('still returns the waId when storing the row fails', async () => {
    t.deps.messages.insertMany = (): number => {
      throw new Error('db down');
    };
    const res = await sendMessage(t.deps, DM, 'x');
    expect(res.waId).toBe('SENT1');
    expect(t.audit.recent(10).map((r) => [r.action, r.outcome])).toContainEqual(['send_message.store', 'error']);
  });
});

describe('markRead', () => {
  it('marks the latest message and clears unread', async () => {
    expect(await markRead(t.deps, DM)).toBe(true);
    expect(t.gateway.callsTo('markRead')).toHaveLength(1);
    expect(t.chats.get(DM)?.unreadCount).toBe(0);
  });

  it('is a no-op for a chat without messages', async () => {
    expect(await markRead(t.deps, DM2)).toBe(false);
    expect(t.gateway.callsTo('markRead')).toHaveLength(0);
  });

  it('rejects unknown chats and leaves unread alone when WhatsApp fails', async () => {
    await expect(markRead(t.deps, '555@s.whatsapp.net')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    t.gateway.failOn.set('markRead', new Error('boom'));
    await expect(markRead(t.deps, DM)).rejects.toThrow('boom');
    expect(t.chats.get(DM)?.unreadCount).toBe(3);
  });
});
