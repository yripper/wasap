import { describe, expect, it } from 'vitest';
import { migrate, openDb } from './db.js';

describe('openDb', () => {
  it('creates every table and sets user_version', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining(['audit_log', 'chats', 'cleanup_plans', 'contacts', 'jid_aliases', 'messages', 'messages_fts', 'tone_profiles', 'chat_notes']),
    );
    expect(db.pragma('user_version', { simple: true })).toBe(2);
  });

  it('migrate is idempotent', () => {
    const db = openDb(':memory:');
    expect(() => migrate(db)).not.toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(2);
  });

  it('keeps the FTS index in sync on insert, update and delete', () => {
    const db = openDb(':memory:');
    const count = (q: string): number =>
      (db.prepare('SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH ?').get(q) as { n: number }).n;
    db.prepare("INSERT INTO messages (chat_id, wa_id, from_me, ts, text) VALUES ('111@s.whatsapp.net', 'a', 0, 0, 'hello world')").run();
    expect(count('hello')).toBe(1);
    db.prepare("UPDATE messages SET text = 'goodbye' WHERE wa_id = 'a'").run();
    expect(count('hello')).toBe(0);
    expect(count('goodbye')).toBe(1);
    db.prepare('UPDATE messages SET text = NULL WHERE wa_id = ?').run('a');
    expect(count('goodbye')).toBe(0);
    db.prepare('DELETE FROM messages').run();
    expect(count('goodbye')).toBe(0);
  });
});
