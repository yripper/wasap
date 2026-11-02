import type { Db } from './db.js';
import type { ChatKind } from './types.js';

export type CleanupMode = 'remove' | 'archive';
export type CleanupAction = 'delete' | 'leave' | 'archive';

/// Stored as JSON; the cleanup domain module (later task) owns its shape.
export type CleanupCriteria = Record<string, unknown>;

export interface CleanupItem {
  chatId: string;
  title: string;
  kind: ChatKind;
  action: CleanupAction;
}

export interface CleanupPlan {
  id: string;
  createdAt: number;
  expiresAt: number;
  mode: CleanupMode;
  criteria: CleanupCriteria;
  items: CleanupItem[];
  status: 'draft' | 'applied';
}

export class CleanupPlansRepo {
  constructor(private readonly db: Db) {}

  insert(p: CleanupPlan): void {
    this.db
      .prepare(
        `INSERT INTO cleanup_plans (id, created_at, expires_at, mode, criteria_json, items_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.id, p.createdAt, p.expiresAt, p.mode, JSON.stringify(p.criteria), JSON.stringify(p.items), p.status);
  }

  get(id: string): CleanupPlan | null {
    const r = this.db.prepare('SELECT * FROM cleanup_plans WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      createdAt: Number(r.created_at),
      expiresAt: Number(r.expires_at),
      mode: r.mode as CleanupMode,
      criteria: JSON.parse(String(r.criteria_json)) as CleanupCriteria,
      items: JSON.parse(String(r.items_json)) as CleanupItem[],
      status: r.status as 'draft' | 'applied',
    };
  }

  /// Atomic draft → applied. Returns false if someone already applied it, so
  /// two concurrent cleanup_apply calls can't both run the deletions.
  markApplied(id: string): boolean {
    return this.db.prepare("UPDATE cleanup_plans SET status = 'applied' WHERE id = ? AND status = 'draft'").run(id).changes === 1;
  }
}
