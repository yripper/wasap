import type { Db } from './db.js';

export class ContactsRepo {
  constructor(private readonly db: Db) {}

  upsertMany(contacts: { jid: string; name: string }[]): void {
    const stmt = this.db.prepare('INSERT INTO contacts (jid, name) VALUES (?, ?) ON CONFLICT (jid) DO UPDATE SET name = excluded.name');
    this.db.transaction(() => contacts.forEach((c) => stmt.run(c.jid, c.name)))();
  }

  name(jid: string): string | null {
    const r = this.db.prepare('SELECT name FROM contacts WHERE jid = ?').get(jid) as { name: string } | undefined;
    return r?.name ?? null;
  }

  /// Carries a name across an alias merge without overwriting one the target already has.
  copyIfMissing(from: string, to: string): void {
    if (from === to) return;
    this.db.prepare('INSERT OR IGNORE INTO contacts (jid, name) SELECT ?, name FROM contacts WHERE jid = ?').run(to, from);
  }
}
