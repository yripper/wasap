import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../domain/errors.js';
import { connect, makeToolDeps } from '../testing/tool-deps.js';
import { BASE_INSTRUCTIONS } from './instructions.js';

const DM = '111@s.whatsapp.net';
const GROUP = '999-1@g.us';
const GROUP2 = '999-2@g.us';
const FUTURE = '2030-01-01T00:00:00Z';

let client: Client;
let made: ReturnType<typeof makeToolDeps>;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string }> => {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as { type: string; text: string }[];
  return { isError: res.isError === true, text: content[0]?.text ?? '' };
};
const json = async (name: string, args: Record<string, unknown> = {}): Promise<any> => JSON.parse((await call(name, args)).text); // eslint-disable-line @typescript-eslint/no-explicit-any

function seed(): void {
  const { chats, messages } = made.t;
  chats.upsert({ id: DM, kind: 'dm', title: 'Test DM', unread: { kind: 'absolute', count: 0, markedUnread: false } }, 1000);
  chats.upsert({ id: GROUP, kind: 'group', title: 'Test Group', unread: { kind: 'absolute', count: 0, markedUnread: true } }, 1000);
  chats.upsert({ id: GROUP2, kind: 'group', title: 'Other Group' }, 1000);
  const base = { fromMe: false, senderJid: null, mediaKind: null, quotedId: null, sentViaWasap: false };
  messages.insertMany([
    { ...base, chatId: DM, waId: 'A1', ts: 2000, text: 'hello there' },
    { ...base, chatId: DM, waId: 'A2', fromMe: true, ts: 2001, text: 'my own reply' },
    { ...base, chatId: GROUP, waId: 'B1', senderJid: '222@lid', ts: 2002, text: 'hello group' },
    { ...base, chatId: GROUP, waId: 'B2', fromMe: true, ts: 2003, text: 'group reply' },
    { ...base, chatId: GROUP, waId: 'B3', senderJid: '222@lid', ts: 2004, text: null, mediaKind: 'audio' },
    { ...base, chatId: GROUP2, waId: 'C1', fromMe: true, ts: 2005, text: 'other group msg' },
  ]);
}

beforeEach(async () => {
  made = makeToolDeps();
  seed();
  client = await connect(made.deps);
});

describe('MCP tools', () => {
  it('exposes exactly the 24 tools with safety annotations', async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect([...byName.keys()].sort()).toEqual(
      [
        'status', 'list_chats', 'get_pending', 'read_history', 'search_messages', 'get_chat_info',
        'snooze', 'unsnooze', 'set_watch_level', 'set_category',
        'get_voice', 'get_my_messages', 'save_profile', 'save_chat_notes', 'list_stale_profiles',
        'send_message', 'mark_read',
        'archive_chats', 'unarchive_chats', 'mute_chat', 'unmute_chat',
        'leave_group', 'cleanup_plan', 'cleanup_apply',
      ].sort(),
    );
    for (const name of ['leave_group', 'cleanup_apply']) expect(byName.get(name)?.annotations?.destructiveHint).toBe(true);
    for (const name of ['snooze', 'unsnooze', 'set_watch_level', 'set_category', 'save_profile', 'save_chat_notes']) {
      expect(byName.get(name)?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    }
    for (const name of ['status', 'list_chats', 'get_pending', 'read_history', 'search_messages', 'get_chat_info', 'get_voice', 'get_my_messages', 'list_stale_profiles']) {
      expect(byName.get(name)?.annotations?.readOnlyHint).toBe(true);
    }
  });

  it('sends the usage instructions on initialize', () => {
    expect(client.getInstructions()).toBe(BASE_INSTRUCTIONS);
  });

  it('status reports connection and counts', async () => {
    expect(await json('status')).toMatchObject({ connection: 'open', lastEventAt: null, chats: 3, messages: 6, pending: 1 });
  });

  it('get_pending returns the marked-unread group with its latest incoming message', async () => {
    const pending = await json('get_pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: GROUP, reason: 'marked_unread', latest_incoming: { text: '[audio]', from: { jid: '222@lid' } } });
  });

  it('reading never marks anything read or calls the gateway', async () => {
    await call('get_pending');
    await call('read_history', { chat_id: GROUP });
    await call('search_messages', { query: 'hello' });
    await call('get_voice', { chat_id: GROUP });
    expect(made.t.gateway.calls).toEqual([]);
    expect((await json('get_pending'))).toHaveLength(1);
  });

  it('read_history is newest first and paginates by seq', async () => {
    const all = await json('read_history', { chat_id: GROUP });
    expect(all.map((m: { text: string }) => m.text)).toEqual(['[audio]', 'group reply', 'hello group']);
    const older = await json('read_history', { chat_id: GROUP, before_seq: all[1].seq });
    expect(older).toHaveLength(1);
    expect((await call('read_history', { chat_id: 'nope@g.us' })).text.startsWith('NOT_FOUND:')).toBe(true);
  });

  it('search_messages and list_chats read the mirror', async () => {
    expect(await json('search_messages', { query: 'hello' })).toHaveLength(2);
    expect((await json('list_chats', { kind: 'group' })).map((c: { id: string }) => c.id).sort()).toEqual([GROUP, GROUP2]);
  });

  it('send_message records one send and one markRead, and clears pending', async () => {
    const res = await json('send_message', { chat_id: GROUP, text: 'sending now' });
    expect(res).toMatchObject({ markedRead: true });
    expect(made.t.gateway.callsTo('sendText')).toHaveLength(1);
    expect(made.t.gateway.callsTo('markRead')).toHaveLength(1);
    expect(await json('get_pending')).toEqual([]);
  });

  it('rejects invalid input without sending', async () => {
    const res = await call('send_message', { chat_id: GROUP, text: '' });
    expect(res.isError).toBe(true);
    expect(made.t.gateway.callsTo('sendText')).toHaveLength(0);
  });

  it('formats gateway errors with code and retry hint', async () => {
    made.t.gateway.failOn.set('sendText', new AppError('FLOOD_WAIT', 'x', 42));
    const res = await call('send_message', { chat_id: GROUP, text: 'hello' });
    expect(res).toMatchObject({ isError: true });
    expect(res.text).toContain('FLOOD_WAIT');
    expect(res.text).toContain('(retry after 42s)');
  });

  it('get_voice without a profile needs learning and returns only own messages', async () => {
    const v = await json('get_voice', { chat_id: GROUP });
    expect(v).toMatchObject({ category: 'general', profile: null, needsLearning: true });
    expect(v.my_messages_in_chat.map((m: { text: string }) => m.text)).toEqual(['group reply']);
    expect(v.my_messages_in_chat.every((m: { from: string }) => m.from === 'me')).toBe(true);
    // Category samples span every chat in the category, own messages only.
    expect(v.my_messages_in_category.map((m: { text: string }) => m.text).sort()).toEqual(['group reply', 'my own reply', 'other group msg']);
    expect(v.my_messages_in_category.every((m: { from: string }) => m.from === 'me')).toBe(true);
  });

  it('get_voice omits samples once a fresh profile exists, then save_chat_notes round-trips', async () => {
    expect(await call('save_profile', { category: 'general', body: 'short and casual' })).toMatchObject({ isError: false });
    await call('save_chat_notes', { chat_id: GROUP, body: 'uses jaja' });
    const v = await json('get_voice', { chat_id: GROUP });
    expect(v).toMatchObject({ profile: 'short and casual', notes: 'uses jaja', needsLearning: false, notesStale: false });
    expect(v.my_messages_in_chat).toBeUndefined();
    expect(v.my_messages_in_category).toBeUndefined();
  });

  it('save_profile and set_category enforce the category rule', async () => {
    for (const bad of ['Work', 'a b', 'x'.repeat(33), '']) {
      expect((await call('save_profile', { category: bad, body: 'x' })).isError).toBe(true);
      expect((await call('set_category', { chat_id: GROUP, category: bad })).isError).toBe(true);
    }
    expect((await call('set_category', { chat_id: GROUP, category: 'work-1' })).isError).toBe(false);
    expect((await json('get_chat_info', { chat_id: GROUP })).category).toBe('work-1');
  });

  it('get_my_messages needs exactly one of chat_id or category', async () => {
    expect((await call('get_my_messages', {})).text.startsWith('VALIDATION:')).toBe(true);
    expect((await call('get_my_messages', { chat_id: GROUP, category: 'general' })).text.startsWith('VALIDATION:')).toBe(true);
    expect(await json('get_my_messages', { chat_id: DM })).toHaveLength(1);
    expect(await json('get_my_messages', { category: 'general' })).toHaveLength(3);
  });

  it('list_stale_profiles lists categories past their window', async () => {
    await call('save_profile', { category: 'general', body: 'x' });
    expect((await json('list_stale_profiles')).categories).toEqual([]);
    made.t.clock.ms += 22 * 86400 * 1000;
    expect((await json('list_stale_profiles')).categories).toEqual(['general']);
  });

  it('snooze hides a chat from pending and unsnooze restores it', async () => {
    expect((await call('snooze', { chat_id: GROUP, until: FUTURE })).isError).toBe(false);
    expect(await json('get_pending')).toEqual([]);
    await call('unsnooze', { chat_id: GROUP });
    expect(await json('get_pending')).toHaveLength(1);
    expect((await call('snooze', { chat_id: GROUP, until: '1970-01-01T00:00:00Z' })).text.startsWith('VALIDATION:')).toBe(true);
  });

  it('mute_chat without until mutes forever and reports it as forever', async () => {
    await call('mute_chat', { chat_id: GROUP });
    expect(made.t.gateway.callsTo('setMuted')).toEqual([[GROUP, -1]]);
    expect((await json('get_chat_info', { chat_id: GROUP })).muted).toBe('forever');
    await call('mute_chat', { chat_id: GROUP, until: FUTURE });
    expect(made.t.gateway.callsTo('setMuted')[1]).toEqual([GROUP, 1893456000]);
    expect((await json('get_chat_info', { chat_id: GROUP })).muted).toBe('2030-01-01T00:00:00.000Z');
    await call('unmute_chat', { chat_id: GROUP });
    expect((await json('get_chat_info', { chat_id: GROUP })).muted).toBeNull();
  });

  it('archive_chats goes through the gateway', async () => {
    expect((await call('archive_chats', { chat_ids: [GROUP] })).isError).toBe(false);
    expect(made.t.gateway.callsTo('setArchived')).toHaveLength(1);
  });

  it('set_watch_level updates the chat', async () => {
    await call('set_watch_level', { chat_id: GROUP2, level: 'full' });
    expect((await json('get_chat_info', { chat_id: GROUP2 })).watch_level).toBe('full');
  });

  it('cleanup_plan then cleanup_apply leaves approved groups only', async () => {
    const plan = await json('cleanup_plan', { inactive_days: 1 });
    expect(plan.items.map((i: { chat_id: string }) => i.chat_id).sort()).toEqual([GROUP, GROUP2]);
    const report = await json('cleanup_apply', { plan_id: plan.plan_id, chat_ids: [GROUP2] });
    expect(report).toEqual({ left: [GROUP2], failed: [] });
    expect(made.t.gateway.callsTo('leaveGroup')).toEqual([[GROUP2]]);
  });

  it('leave_group rejects DMs', async () => {
    expect((await call('leave_group', { chat_id: DM })).isError).toBe(true);
  });
});
