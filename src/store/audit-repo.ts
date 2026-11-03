import type { Db } from './db.js';

/// Metadata only. Never pass message text, titles or secrets in `action`.
export class AuditRepo {
  constructor(private readonly db: Db) {}

  record(action: string, chatId: string | null, outcome: 'ok' | 'error', nowSec: number): void {
    this.db.prepare('INSERT INTO audit_log (ts, action, chat_id, outcome) VALUES (?, ?, ?, ?)').run(nowSec, action, chatId, outcome);
  }

  recent(limit: number): { ts: number; action: string; chatId: string | null; outcome: string }[] {
    return (
      this.db.prepare('SELECT ts, action, chat_id, outcome FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as {
        ts: number;
        action: string;
        chat_id: string | null;
        outcome: string;
      }[]
    ).map((r) => ({ ts: r.ts, action: r.action, chatId: r.chat_id, outcome: r.outcome }));
  }
}
