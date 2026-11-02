import { beforeEach, describe, expect, it } from 'vitest';
import { ChatsRepo } from './chats-repo.js';
import { openDb, type Db } from './db.js';
import { MessagesRepo } from './messages-repo.js';
import { VoiceRepo } from './voice-repo.js';

describe('VoiceRepo', () => {
  let db: Db;
  let voice: VoiceRepo;
  beforeEach(() => {
    db = openDb(':memory:');
    voice = new VoiceRepo(db);
  });

  it('returns null when nothing is saved', () => {
    expect(voice.getProfile('work')).toBeNull();
    expect(voice.getNotes('111@s.whatsapp.net')).toBeNull();
  });

  it('saves and overwrites profiles, listing metadata only', () => {
    voice.saveProfile('work', 'first', 10);
    voice.saveProfile('work', 'second', 20);
    voice.saveProfile('family', 'x', 5);
    expect(voice.getProfile('work')).toEqual({ body: 'second', updatedAt: 20 });
    expect(voice.listProfiles()).toEqual([
      { category: 'family', updatedAt: 5 },
      { category: 'work', updatedAt: 20 },
    ]);
  });

  it('saves and overwrites per-chat notes', () => {
    voice.saveNotes('111@s.whatsapp.net', 'a', 1);
    voice.saveNotes('111@s.whatsapp.net', 'b', 2);
    expect(voice.getNotes('111@s.whatsapp.net')).toEqual({ body: 'b', updatedAt: 2 });
  });

  it('counts outgoing messages across chats currently in a category, uncapped', () => {
    const chats = new ChatsRepo(db, () => 'normal');
    const messages = new MessagesRepo(db);
    for (const id of ['111@s.whatsapp.net', '999-1@g.us', '222@lid']) chats.upsert({ id, kind: 'dm' }, 1);
    chats.setCategory('111@s.whatsapp.net', 'work');
    chats.setCategory('999-1@g.us', 'work');
    const rows = Array.from({ length: 150 }, (_, i) => ({
      chatId: i % 2 ? '111@s.whatsapp.net' : '999-1@g.us',
      waId: `w${i}`, fromMe: true, senderJid: null, ts: 100 + i, text: null, mediaKind: null, quotedId: null, sentViaWasap: false,
    }));
    rows.push({ chatId: '222@lid', waId: 'o', fromMe: true, senderJid: null, ts: 200, text: null, mediaKind: null, quotedId: null, sentViaWasap: false });
    rows.push({ chatId: '111@s.whatsapp.net', waId: 'in', fromMe: false, senderJid: null, ts: 200, text: null, mediaKind: null, quotedId: null, sentViaWasap: false });
    messages.insertMany(rows);
    expect(voice.countOutgoingInCategory('work', 0)).toBe(150);
    expect(voice.countOutgoingInCategory('work', 200)).toBe(50);
    expect(voice.countOutgoingInCategory('general', 0)).toBe(1);
  });
});
