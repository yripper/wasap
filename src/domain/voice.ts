import type { ChatsRepo } from '../store/chats-repo.js';
import type { MessagesRepo } from '../store/messages-repo.js';
import type { VoiceRepo } from '../store/voice-repo.js';
import { AppError } from './errors.js';

/// A profile/notes entry goes stale after this many of my sent messages or this much time.
export const STALE = { sentMessages: 30, ageSec: 21 * 86400 } as const;

export interface VoiceDeps {
  chats: ChatsRepo;
  messages: MessagesRepo;
  voice: VoiceRepo;
}

export interface VoiceContext {
  category: string;
  profile: string | null;
  notes: string | null;
  profileStale: boolean;
  notesStale: boolean;
  needsLearning: boolean;
}

export function isStale(updatedAt: number, sentSince: number, nowSec: number): boolean {
  return sentSince >= STALE.sentMessages || nowSec - updatedAt >= STALE.ageSec;
}

function profileIsStale(d: VoiceDeps, category: string, updatedAt: number, nowSec: number): boolean {
  return isStale(updatedAt, d.voice.countOutgoingInCategory(category, updatedAt), nowSec);
}

export function voiceContext(d: VoiceDeps, chatId: string, nowSec: number): VoiceContext {
  const chat = d.chats.get(chatId);
  if (!chat) throw new AppError('NOT_FOUND', 'Unknown chat');
  const category = chat.category;
  const profile = d.voice.getProfile(category);
  const notes = d.voice.getNotes(chatId);
  const profileStale = profile ? profileIsStale(d, category, profile.updatedAt, nowSec) : false;
  const notesStale = notes
    ? isStale(notes.updatedAt, d.messages.countOutgoingSince([chatId], notes.updatedAt), nowSec)
    : false;
  return {
    category,
    profile: profile?.body ?? null,
    notes: notes?.body ?? null,
    profileStale,
    notesStale,
    needsLearning: profile === null || profileStale,
  };
}

/// Categories whose saved profile is due for a refresh.
export function staleProfiles(d: VoiceDeps, nowSec: number): string[] {
  return d.voice
    .listProfiles()
    .filter((p) => profileIsStale(d, p.category, p.updatedAt, nowSec))
    .map((p) => p.category);
}
