import { beforeEach, describe, expect, it } from 'vitest';
import { ChatsRepo } from '../store/chats-repo.js';
import { openDb } from '../store/db.js';
import { MessagesRepo } from '../store/messages-repo.js';
import { VoiceRepo } from '../store/voice-repo.js';
import { AppError } from './errors.js';
import { STALE, isStale, staleProfiles, voiceContext } from './voice.js';

const DAY = 86400;
const W1 = '111@s.whatsapp.net';
const W2 = '999-1@g.us';
const F1 = '222@lid';

describe('isStale', () => {
  it('flips at 30 sent messages', () => {
    expect(isStale(0, 29, 1)).toBe(false);
    expect(isStale(0, 30, 1)).toBe(true);
  });
  it('flips at 21 days', () => {
    expect(isStale(0, 0, 20 * DAY)).toBe(false);
    expect(isStale(0, 0, 21 * DAY)).toBe(true);
    expect(STALE).toEqual({ sentMessages: 30, ageSec: 21 * DAY });
  });
});

describe('voiceContext', () => {
  let deps: { chats: ChatsRepo; messages: MessagesRepo; voice: VoiceRepo };
  beforeEach(() => {
    const db = openDb(':memory:');
    deps = { chats: new ChatsRepo(db, () => 'normal'), messages: new MessagesRepo(db), voice: new VoiceRepo(db) };
    for (const id of [W1, W2, F1]) deps.chats.upsert({ id, kind: 'dm' }, 1);
    deps.chats.setCategory(W1, 'work');
    deps.chats.setCategory(W2, 'work');
    deps.chats.setCategory(F1, 'family');
  });
  const sent = (chatId: string, n: number, ts: number): void => {
    deps.messages.insertMany(
      Array.from({ length: n }, (_, i) => ({
        chatId, waId: `${chatId}-${ts}-${i}`, fromMe: true, senderJid: null, ts, text: null, mediaKind: null, quotedId: null, sentViaWasap: false,
      })),
    );
  };

  it('needs learning when the category has no profile', () => {
    expect(voiceContext(deps, W1, 100)).toEqual({
      category: 'work', profile: null, notes: null, profileStale: false, notesStale: false, needsLearning: true,
    });
  });

  it('throws NOT_FOUND for an unknown chat', () => {
    expect(() => voiceContext(deps, 'nope@g.us', 1)).toThrow(AppError);
    try {
      voiceContext(deps, 'nope@g.us', 1);
    } catch (e) {
      expect((e as AppError).code).toBe('NOT_FOUND');
    }
  });

  it('marks the profile stale after 30 sent messages across two chats in the category', () => {
    deps.voice.saveProfile('work', 'p', 100);
    sent(W1, 15, 200);
    sent(W2, 14, 200);
    expect(voiceContext(deps, W1, 300)).toMatchObject({ profile: 'p', profileStale: false, needsLearning: false });
    sent(W2, 1, 201);
    expect(voiceContext(deps, W1, 300)).toMatchObject({ profileStale: true, needsLearning: true });
  });

  it('does not let work messages affect a family profile', () => {
    deps.voice.saveProfile('family', 'f', 100);
    sent(W1, 40, 200);
    expect(voiceContext(deps, F1, 300)).toMatchObject({ profile: 'f', profileStale: false, needsLearning: false });
  });

  it('marks profile stale by age', () => {
    deps.voice.saveProfile('work', 'p', 0);
    expect(voiceContext(deps, W1, 21 * DAY).profileStale).toBe(true);
  });

  it('notes staleness counts only that chat and is false without notes', () => {
    expect(voiceContext(deps, W1, 100).notesStale).toBe(false);
    deps.voice.saveNotes(W1, 'n', 100);
    sent(W2, 40, 200);
    expect(voiceContext(deps, W1, 300)).toMatchObject({ notes: 'n', notesStale: false });
    sent(W1, 30, 200);
    expect(voiceContext(deps, W1, 300).notesStale).toBe(true);
  });

  it('staleProfiles lists categories whose profile is stale', () => {
    deps.voice.saveProfile('work', 'p', 100);
    deps.voice.saveProfile('family', 'f', 100);
    sent(W1, 30, 200);
    expect(staleProfiles(deps, 300)).toEqual(['work']);
  });
});
