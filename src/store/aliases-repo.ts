import type { Db } from './db.js';

/// Maps alternate JIDs (@lid vs phone-number form) to one canonical chat id.
export class AliasesRepo {
  constructor(private readonly db: Db) {}

  resolve(jid: string): string {
    const r = this.db.prepare('SELECT canonical FROM jid_aliases WHERE alias = ?').get(jid) as { canonical: string } | undefined;
    return r?.canonical ?? jid;
  }

  add(alias: string, canonical: string): void {
    if (alias === canonical) return;
    this.db.prepare('INSERT OR REPLACE INTO jid_aliases (alias, canonical) VALUES (?, ?)').run(alias, canonical);
  }

  /// The old canonical id becomes an alias too, so it still resolves.
  repoint(oldCanonical: string, newCanonical: string): void {
    if (oldCanonical === newCanonical) return;
    this.db.transaction(() => {
      this.db.prepare('UPDATE jid_aliases SET canonical = ? WHERE canonical = ?').run(newCanonical, oldCanonical);
      this.add(oldCanonical, newCanonical);
    })();
  }
}
