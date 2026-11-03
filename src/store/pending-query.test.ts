import { beforeEach, describe, expect, it } from 'vitest';
import { pendingReason } from '../domain/pending.js';
import { ChatsRepo } from './chats-repo.js';
import { openDb, type Db } from './db.js';
import { MessagesRepo } from './messages-repo.js';
import { listPending } from './pending-query.js';

const NOW = 1000;

describe('listPending', () => {
  let db: Db;
  let chats: ChatsRepo;
  let msgs: MessagesRepo;
  beforeEach(() => {
    db = openDb(':memory:');
    chats = new ChatsRepo(db, () => 'normal');
    msgs = new MessagesRepo(db);
  });

  const add = (id: string, kind: 'dm' | 'group', unread: number, marked = false): void => {
    chats.upsert({ id, kind, unread: { kind: 'absolute', count: unread, markedUnread: marked } }, 1);
  };
  const say = (chatId: string, waId: string, ts: number, fromMe = false): void => {
    msgs.insertMany([{ chatId, waId, fromMe, senderJid: null, ts, text: 'x', mediaKind: null, quotedId: null, sentViaWasap: false }]);
  };

  it('returns exactly the rule-matching chats in order and agrees with pendingReason', () => {
    add('111@s.whatsapp.net', 'dm', 2); // unread DM, ts 500
    add('112@s.whatsapp.net', 'dm', 1); // unread DM, ts 700 (newer)
    add('999-1@g.us', 'group', 0, true); // marked unread group, old
    add('999-2@g.us', 'group', 4); // full watch group
    chats.setWatchLevel('999-2@g.us', 'full');
    add('999-3@g.us', 'group', 4); // normal group: excluded
    add('113@s.whatsapp.net', 'dm', 1); // snoozed: excluded
    chats.setSnooze('113@s.whatsapp.net', NOW + 50);
    add('114@s.whatsapp.net', 'dm', 1); // archived: excluded
    chats.setArchived('114@s.whatsapp.net', true);
    add('115@s.whatsapp.net', 'dm', 1, true); // watch muted: excluded
    chats.setWatchLevel('115@s.whatsapp.net', 'muted');

    say('111@s.whatsapp.net', 'a1', 500);
    say('112@s.whatsapp.net', 'b1', 600);
    say('112@s.whatsapp.net', 'b2', 700);
    say('999-1@g.us', 'c1', 100);
    say('999-2@g.us', 'd1', 50);
    say('999-3@g.us', 'e1', 900);

    const items = listPending(db, NOW, 50);
    expect(items.map((i) => i.chat.id)).toEqual(['999-1@g.us', '999-2@g.us', '112@s.whatsapp.net', '111@s.whatsapp.net']);
    expect(items.map((i) => i.reason)).toEqual(['marked_unread', 'unread', 'unread', 'unread']);

    const ids = new Set(items.map((i) => i.chat.id));
    for (const c of chats.list({ limit: 100, offset: 0 })) {
      expect(ids.has(c.id), c.id).toBe(pendingReason(c, NOW) !== null);
    }
  });

  it('lastIncoming is the newest non-deleted incoming message, or null', () => {
    add('111@s.whatsapp.net', 'dm', 3);
    say('111@s.whatsapp.net', 'a1', 10);
    say('111@s.whatsapp.net', 'a2', 20);
    say('111@s.whatsapp.net', 'a3', 30);
    say('111@s.whatsapp.net', 'a4', 40, true);
    msgs.softDelete('111@s.whatsapp.net', 'a3', 31);
    add('112@s.whatsapp.net', 'dm', 1);
    const items = listPending(db, NOW, 10);
    const byId = new Map(items.map((i) => [i.chat.id, i]));
    expect(byId.get('111@s.whatsapp.net')?.lastIncoming?.waId).toBe('a2');
    expect(byId.get('112@s.whatsapp.net')?.lastIncoming).toBeNull();
  });

  it('applies the limit after ordering', () => {
    add('111@s.whatsapp.net', 'dm', 1);
    add('112@s.whatsapp.net', 'dm', 1);
    say('111@s.whatsapp.net', 'a', 1);
    say('112@s.whatsapp.net', 'b', 2);
    expect(listPending(db, NOW, 1).map((i) => i.chat.id)).toEqual(['112@s.whatsapp.net']);
  });
});
