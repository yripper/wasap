import { beforeEach, describe, expect, it } from 'vitest';
import { AuditRepo } from './audit-repo.js';
import { ChatsRepo } from './chats-repo.js';
import { CleanupPlansRepo } from './cleanup-plans-repo.js';
import { openDb, type Db } from './db.js';
import { MessagesRepo } from './messages-repo.js';
import type { NewMessage } from './types.js';
import { VoiceRepo } from './voice-repo.js';

const DM = '111@s.whatsapp.net';
const LID = '222@lid';
const GROUP = '999-1@g.us';

function msg(chatId: string, waId: string, ts: number, over: Partial<NewMessage> = {}): NewMessage {
  return { chatId, waId, fromMe: false, senderJid: null, ts, text: 'hello', mediaKind: null, quotedId: null, sentViaWasap: false, ...over };
}

describe('ChatsRepo', () => {
  let db: Db;
  let repo: ChatsRepo;
  beforeEach(() => {
    db = openDb(':memory:');
    repo = new ChatsRepo(db, (kind) => (kind === 'dm' ? 'normal' : 'muted'));
  });

  it('uses the default watch level per kind', () => {
    repo.upsert({ id: DM, kind: 'dm' }, 10);
    repo.upsert({ id: GROUP, kind: 'group' }, 10);
    expect(repo.get(DM)?.watchLevel).toBe('normal');
    expect(repo.get(DM)?.category).toBe('general');
    expect(repo.get(GROUP)?.watchLevel).toBe('muted');
    expect(repo.get('nope@s.whatsapp.net')).toBeNull();
  });

  it('wa_jid defaults to the id and only changes when supplied', () => {
    repo.upsert({ id: DM, kind: 'dm' }, 1);
    expect(repo.get(DM)?.waJid).toBe(DM);
    repo.upsert({ id: DM, kind: 'dm', waJid: LID }, 1);
    expect(repo.get(DM)?.waJid).toBe(LID);
    repo.upsert({ id: DM, kind: 'dm' }, 1);
    expect(repo.get(DM)?.waJid).toBe(LID);
  });

  it('upsert twice keeps watchLevel, category and snoozeUntil', () => {
    repo.upsert({ id: DM, kind: 'dm', title: 'T' }, 10);
    repo.setWatchLevel(DM, 'full');
    repo.setCategory(DM, 'waiting');
    repo.setSnooze(DM, 500);
    repo.upsert({ id: DM, kind: 'dm', title: null, archived: true }, 20);
    const c = repo.get(DM);
    expect(c).toMatchObject({ watchLevel: 'full', category: 'waiting', snoozeUntil: 500, title: 'T', archived: true, createdAt: 10 });
  });

  describe('applyUnread', () => {
    const seed = (count: number, marked: boolean): void => {
      repo.upsert({ id: DM, kind: 'dm' }, 1);
      repo.applyUnread(DM, { kind: 'absolute', count, markedUnread: marked });
    };

    it('live positive adds to the count and leaves marked unchanged', () => {
      seed(2, false);
      repo.applyUnread(DM, { kind: 'live', value: 3 });
      expect(repo.get(DM)).toMatchObject({ unreadCount: 5, markedUnread: false });
    });

    it('live positive on a marked-unread chat stored at 0 keeps marked', () => {
      seed(-1, true);
      expect(repo.get(DM)).toMatchObject({ unreadCount: 0, markedUnread: true });
      repo.applyUnread(DM, { kind: 'live', value: 1 });
      expect(repo.get(DM)).toMatchObject({ unreadCount: 1, markedUnread: true });
    });

    it('live 0 clears count and marked', () => {
      seed(4, true);
      repo.applyUnread(DM, { kind: 'live', value: 0 });
      expect(repo.get(DM)).toMatchObject({ unreadCount: 0, markedUnread: false });
    });

    it('live -1 marks unread and leaves the count', () => {
      seed(4, false);
      repo.applyUnread(DM, { kind: 'live', value: -1 });
      expect(repo.get(DM)).toMatchObject({ unreadCount: 4, markedUnread: true });
    });

    it('live null changes nothing', () => {
      seed(4, true);
      repo.applyUnread(DM, { kind: 'live', value: null });
      expect(repo.get(DM)).toMatchObject({ unreadCount: 4, markedUnread: true });
    });

    it('absolute sets count and flag; negative becomes marked', () => {
      seed(0, false);
      repo.applyUnread(DM, { kind: 'absolute', count: 4, markedUnread: false });
      expect(repo.get(DM)).toMatchObject({ unreadCount: 4, markedUnread: false });
      repo.applyUnread(DM, { kind: 'absolute', count: -1, markedUnread: false });
      expect(repo.get(DM)).toMatchObject({ unreadCount: 4, markedUnread: true });
    });

    it('absolute never lowers: a later history chunk without a count keeps the earlier one', () => {
      seed(0, false);
      repo.applyUnread(DM, { kind: 'absolute', count: 7, markedUnread: true });
      repo.applyUnread(DM, { kind: 'absolute', count: 0, markedUnread: false });
      expect(repo.get(DM)).toMatchObject({ unreadCount: 7, markedUnread: true });
      repo.applyUnread(DM, { kind: 'absolute', count: 3, markedUnread: false });
      expect(repo.get(DM)?.unreadCount).toBe(7);
    });

    it('live 0 still clears what history set', () => {
      seed(0, false);
      repo.applyUnread(DM, { kind: 'absolute', count: 7, markedUnread: true });
      repo.applyUnread(DM, { kind: 'live', value: 0 });
      expect(repo.get(DM)).toMatchObject({ unreadCount: 0, markedUnread: false });
    });

    it('upsert applies a supplied unread signal', () => {
      repo.upsert({ id: DM, kind: 'dm', unread: { kind: 'absolute', count: 3, markedUnread: false } }, 1);
      expect(repo.get(DM)?.unreadCount).toBe(3);
    });
  });

  it('touchLastMessage only moves forward', () => {
    repo.upsert({ id: DM, kind: 'dm' }, 1);
    repo.touchLastMessage(DM, 100, true);
    repo.touchLastMessage(DM, 50, false);
    expect(repo.get(DM)).toMatchObject({ lastMsgTs: 100, lastMsgFromMe: true });
    repo.touchLastMessage(DM, 100, false);
    expect(repo.get(DM)?.lastMsgFromMe).toBe(false);
  });

  it('list filters, searches and orders newest first', () => {
    repo.upsert({ id: DM, kind: 'dm', title: 'Alpha_1' }, 1);
    repo.upsert({ id: GROUP, kind: 'group', title: 'Beta' }, 1);
    repo.touchLastMessage(DM, 10, false);
    repo.touchLastMessage(GROUP, 20, false);
    expect(repo.list({ limit: 10, offset: 0 }).map((c) => c.id)).toEqual([GROUP, DM]);
    expect(repo.list({ kind: 'dm', limit: 10, offset: 0 }).map((c) => c.id)).toEqual([DM]);
    expect(repo.list({ query: 'alpha_', limit: 10, offset: 0 }).map((c) => c.id)).toEqual([DM]);
    expect(repo.list({ query: 'alpha%', limit: 10, offset: 0 })).toEqual([]);
    expect(repo.list({ watchLevel: 'muted', limit: 10, offset: 0 }).map((c) => c.id)).toEqual([GROUP]);
    expect(repo.list({ limit: 1, offset: 1 }).map((c) => c.id)).toEqual([DM]);
  });

  it('setters update archived, wa mute and category filter', () => {
    repo.upsert({ id: DM, kind: 'dm' }, 1);
    repo.setArchived(DM, true);
    repo.setWaMuted(DM, 999);
    repo.setCategory(DM, 'done');
    expect(repo.get(DM)).toMatchObject({ archived: true, waMutedUntil: 999 });
    expect(repo.list({ category: 'done', limit: 5, offset: 0 })).toHaveLength(1);
  });

  describe('mergeInto', () => {
    it('merges messages, local fields from the older row, and counters', () => {
      const messages = new MessagesRepo(db);
      repo.upsert({ id: DM, kind: 'dm', title: 'Into', unread: { kind: 'absolute', count: 2, markedUnread: false } }, 200);
      repo.upsert({ id: LID, kind: 'dm', title: null, unread: { kind: 'absolute', count: 3, markedUnread: true } }, 100);
      repo.setWatchLevel(LID, 'full');
      repo.setCategory(LID, 'waiting');
      repo.setSnooze(LID, 777);
      messages.insertMany([msg(DM, 'a', 10, { text: 'alpha' }), msg(DM, 'dup', 11, { text: 'dupe' })]);
      messages.insertMany([msg(LID, 'dup', 11, { text: 'dupe' }), msg(LID, 'b', 30, { text: 'bravo', fromMe: true })]);

      repo.mergeInto(LID, DM);

      expect(repo.get(LID)).toBeNull();
      expect(repo.get(DM)).toMatchObject({
        title: 'Into',
        watchLevel: 'full',
        category: 'waiting',
        snoozeUntil: 777,
        createdAt: 100,
        // Both aliases carry the same WhatsApp snapshot, so summing would double-count.
        unreadCount: 3,
        markedUnread: true,
        lastMsgTs: 30,
        lastMsgFromMe: true,
      });
      expect(messages.history(DM, { limit: 10 }).map((m) => m.waId).sort()).toEqual(['a', 'b', 'dup']);
      expect(messages.history(LID, { limit: 10 })).toEqual([]);
      expect(messages.search('dupe', { limit: 10 })).toHaveLength(1);
      expect(messages.search('bravo', { limit: 10 })).toHaveLength(1);
    });

    it('keeps the into row local fields when it is the older one', () => {
      repo.upsert({ id: DM, kind: 'dm' }, 100);
      repo.upsert({ id: LID, kind: 'dm' }, 200);
      repo.setCategory(DM, 'done');
      repo.setCategory(LID, 'waiting');
      repo.mergeInto(LID, DM);
      expect(repo.get(DM)).toMatchObject({ category: 'done', createdAt: 100 });
    });

    it('keeps the wa_jid seen most recently', () => {
      repo.upsert({ id: DM, kind: 'dm', waJid: DM }, 100);
      repo.upsert({ id: LID, kind: 'dm', waJid: LID }, 200);
      repo.mergeInto(LID, DM);
      expect(repo.get(DM)?.waJid).toBe(LID);
      repo.upsert({ id: GROUP, kind: 'group', waJid: GROUP }, 1);
      repo.upsert({ id: LID, kind: 'dm', waJid: LID }, 300);
      repo.upsert({ id: DM, kind: 'dm', waJid: DM }, 300);
      repo.mergeInto(LID, DM);
      expect(repo.get(DM)?.waJid).toBe(DM);
    });

    it('moves chat notes to the survivor only when it has none', () => {
      const voice = new VoiceRepo(db);
      repo.upsert({ id: DM, kind: 'dm' }, 1);
      repo.upsert({ id: LID, kind: 'dm' }, 2);
      voice.saveNotes(LID, 'casual', 5);
      repo.mergeInto(LID, DM);
      expect(voice.getNotes(DM)).toEqual({ body: 'casual', updatedAt: 5 });
      expect(voice.getNotes(LID)).toBeNull();
      repo.upsert({ id: LID, kind: 'dm' }, 3);
      voice.saveNotes(LID, 'formal', 9);
      repo.mergeInto(LID, DM);
      expect(voice.getNotes(DM)?.body).toBe('casual');
      expect(voice.getNotes(LID)).toBeNull();
    });

    it('moves chat notes when the from row is renamed', () => {
      const voice = new VoiceRepo(db);
      repo.upsert({ id: LID, kind: 'dm' }, 1);
      voice.saveNotes(LID, 'casual', 5);
      repo.mergeInto(LID, DM);
      expect(voice.getNotes(DM)?.body).toBe('casual');
    });

    it('renames the from row when into does not exist', () => {
      const messages = new MessagesRepo(db);
      repo.upsert({ id: LID, kind: 'dm' }, 1);
      messages.insertMany([msg(LID, 'a', 1)]);
      repo.mergeInto(LID, DM);
      expect(repo.get(DM)).not.toBeNull();
      expect(messages.history(DM, { limit: 5 })).toHaveLength(1);
    });
  });
});

describe('AuditRepo', () => {
  it('records and returns recent entries with string chat ids', () => {
    const audit = new AuditRepo(openDb(':memory:'));
    audit.record('send_message', DM, 'ok', 5);
    audit.record('status', null, 'error', 6);
    expect(audit.recent(5)).toEqual([
      { ts: 6, action: 'status', chatId: null, outcome: 'error' },
      { ts: 5, action: 'send_message', chatId: DM, outcome: 'ok' },
    ]);
  });
});

describe('CleanupPlansRepo', () => {
  it('round-trips a plan and applies it once', () => {
    const repo = new CleanupPlansRepo(openDb(':memory:'));
    repo.insert({
      id: 'p1',
      createdAt: 1,
      expiresAt: 2,
      mode: 'archive',
      criteria: { inactiveDays: 30, excludeFull: true },
      items: [{ chatId: GROUP, title: 'G', kind: 'group', action: 'archive', lastMsgTs: null, myLastMsgTs: null, unreadCount: 0 }],
      status: 'draft',
    });
    expect(repo.get('p1')?.items[0]?.chatId).toBe(GROUP);
    expect(repo.markApplied('p1')).toBe(true);
    expect(repo.markApplied('p1')).toBe(false);
    expect(repo.get('p1')?.status).toBe('applied');
    expect(repo.get('zz')).toBeNull();
  });
});
