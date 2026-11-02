import type { Db } from './db.js';

export interface VoiceEntry {
  body: string;
  updatedAt: number;
}

/// Tone profiles (per category) and notes (per chat). Personal data: never log bodies.
export class VoiceRepo {
  constructor(private readonly db: Db) {}

  getProfile(category: string): VoiceEntry | null {
    const r = this.db.prepare('SELECT body, updated_at FROM tone_profiles WHERE category = ?').get(category) as
      | { body: string; updated_at: number }
      | undefined;
    return r ? { body: r.body, updatedAt: r.updated_at } : null;
  }

  saveProfile(category: string, body: string, nowSec: number): void {
    this.db
      .prepare(
        'INSERT INTO tone_profiles (category, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(category) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at',
      )
      .run(category, body, nowSec);
  }

  /// Metadata only, so listing never exposes profile text.
  listProfiles(): { category: string; updatedAt: number }[] {
    const rows = this.db.prepare('SELECT category, updated_at FROM tone_profiles ORDER BY category').all() as {
      category: string;
      updated_at: number;
    }[];
    return rows.map((r) => ({ category: r.category, updatedAt: r.updated_at }));
  }

  getNotes(chatId: string): VoiceEntry | null {
    const r = this.db.prepare('SELECT body, updated_at FROM chat_notes WHERE chat_id = ?').get(chatId) as
      | { body: string; updated_at: number }
      | undefined;
    return r ? { body: r.body, updatedAt: r.updated_at } : null;
  }

  saveNotes(chatId: string, body: string, nowSec: number): void {
    this.db
      .prepare(
        'INSERT INTO chat_notes (chat_id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at',
      )
      .run(chatId, body, nowSec);
  }

  /// Single query over chats whose *current* category matches, so there is no
  /// list cap and recategorized chats count under their new category.
  countOutgoingInCategory(category: string, sinceSec: number): number {
    const r = this.db
      .prepare(
        'SELECT count(*) AS n FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.category = ? AND m.from_me = 1 AND m.ts >= ?',
      )
      .get(category, sinceSec) as { n: number };
    return r.n;
  }
}
