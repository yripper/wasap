import { beforeEach, describe, expect, it } from 'vitest';
import { ChatsRepo } from './chats-repo.js';
import { ContactsRepo } from './contacts-repo.js';
import { openDb, type Db } from './db.js';
import { MessagesRepo } from './messages-repo.js';
import type { NewMessage } from './types.js';

const DM = '111@s.whatsapp.net';
const GROUP = '999-1@g.us';

function msg(chatId: string, waId: string, ts: number, over: Partial<NewMessage> = {}): NewMessage {
  return { chatId, waId, fromMe: false, senderJid: null, ts, text: 'hello', mediaKind: null, quotedId: null, sentViaWasap: false, ...over };
}

describe('MessagesRepo', () => {
  let db: Db;
  let repo: MessagesRepo;
  let chats: ChatsRepo;
  beforeEach(() => {
    db = openDb(':memory:');
    repo = new MessagesRepo(db);
    chats = new ChatsRepo(db, () => 'normal');
    chats.upsert({ id: DM, kind: 'dm' }, 1);
    chats.upsert({ id: GROUP, kind: 'group' }, 1);
  });

  it('ignores duplicates, also within one batch, and searches once', () => {
    expect(repo.insertMany([msg(DM, 'a', 1, { text: 'unique' }), msg(DM, 'a', 1, { text: 'unique' })])).toBe(1);
    expect(repo.insertMany([msg(DM, 'a', 1, { text: 'unique' })])).toBe(0);
    expect(repo.search('unique', { limit: 10 })).toHaveLength(1);
  });

  it('updates last message forward-only inside insertMany', () => {
    repo.insertMany([msg(DM, 'a', 50, { fromMe: true })]);
    repo.insertMany([msg(DM, 'b', 20)]);
    expect(chats.get(DM)).toMatchObject({ lastMsgTs: 50, lastMsgFromMe: true });
  });

  it('history is newest first, respects beforeSeq and joins contact names', () => {
    new ContactsRepo(db).upsertMany([{ jid: '333@s.whatsapp.net', name: 'Alice' }]);
    repo.insertMany([msg(GROUP, 'a', 1), msg(GROUP, 'b', 2, { senderJid: '333@s.whatsapp.net' }), msg(GROUP, 'c', 3)]);
    const all = repo.history(GROUP, { limit: 10 });
    expect(all.map((m) => m.waId)).toEqual(['c', 'b', 'a']);
    expect(all[1]?.senderName).toBe('Alice');
    expect(all[0]?.senderName).toBeNull();
    const older = repo.history(GROUP, { limit: 10, beforeSeq: all[1]?.seq });
    expect(older.map((m) => m.waId)).toEqual(['a']);
    expect(repo.history(GROUP, { limit: 1 })).toHaveLength(1);
  });

  it('softDelete nulls text, sets deletedAt and removes it from search', () => {
    repo.insertMany([msg(DM, 'a', 1, { text: 'secretword' })]);
    repo.softDelete(DM, 'a', 99);
    const [m] = repo.history(DM, { limit: 5 });
    expect(m).toMatchObject({ deletedAt: 99, text: null });
    expect(repo.search('secretword', { limit: 5 })).toEqual([]);
    expect(repo.getText(DM, 'a')).toBeNull();
  });

  it('editText updates text and reindexes', () => {
    repo.insertMany([msg(DM, 'a', 1, { text: 'before' })]);
    repo.editText(DM, 'a', 'after', 5);
    expect(repo.getText(DM, 'a')).toBe('after');
    expect(repo.history(DM, { limit: 1 })[0]?.editedAt).toBe(5);
    expect(repo.search('before', { limit: 5 })).toEqual([]);
    expect(repo.search('after', { limit: 5 })).toHaveLength(1);
  });

  it('search scopes by chat and tolerates FTS syntax', () => {
    repo.insertMany([msg(DM, 'a', 1, { text: 'hello' }), msg(GROUP, 'b', 2, { text: 'hello' })]);
    expect(repo.search('hello', { limit: 10 })).toHaveLength(2);
    expect(repo.search('hello', { chatId: GROUP, limit: 10 })).toHaveLength(1);
    expect(repo.search('"( OR *', { limit: 10 })).toEqual([]);
    expect(repo.search('   ', { limit: 10 })).toEqual([]);
  });

  it('latestKey picks the newest by timestamp', () => {
    expect(repo.latestKey(DM)).toBeNull();
    repo.insertMany([msg(DM, 'new', 10, { fromMe: true, senderJid: DM }), msg(DM, 'old', 5)]);
    expect(repo.latestKey(DM)).toEqual({ waId: 'new', fromMe: true, ts: 10, senderJid: DM });
  });

  it('outgoing and countOutgoingSince only see fromMe messages', () => {
    repo.insertMany([
      msg(DM, 'a', 10, { fromMe: true }),
      msg(DM, 'b', 20, { fromMe: true }),
      msg(DM, 'c', 30),
      msg(GROUP, 'd', 40, { fromMe: true }),
    ]);
    expect(repo.outgoing([DM], { limit: 10 }).map((m) => m.waId)).toEqual(['b', 'a']);
    expect(repo.outgoing([DM, GROUP], { limit: 2 }).map((m) => m.waId)).toEqual(['d', 'b']);
    expect(repo.outgoing([], { limit: 5 })).toEqual([]);
    expect(repo.countOutgoingSince([DM, GROUP], 20)).toBe(2);
    expect(repo.countOutgoingSince([], 0)).toBe(0);
  });
});
