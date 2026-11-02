import { AppError } from '../domain/errors.js';
import type { CleanupCriteria, CleanupItem, CleanupPlan } from '../store/cleanup-plans-repo.js';
import { type ActionDeps } from './context.js';
import { leaveGroup } from './destructive.js';

const PLAN_TTL_SEC = 30 * 60;
const DAY_SEC = 86_400;
/// Pause between leaves: bulk group exits in a tight loop look like spam to WhatsApp.
export const CLEANUP_CALL_GAP_MS = 1000;

/// Step one of two: a list for the user to review, with no side effects on WhatsApp.
export function cleanupPlan(d: ActionDeps, c: CleanupCriteria): CleanupPlan {
  const now = d.now();
  const cutoff = now - c.inactiveDays * DAY_SEC;
  const items: CleanupItem[] = d.chats
    .list({ kind: 'group', limit: 100_000, offset: 0 })
    .filter((g) => g.watchLevel !== 'full')
    .flatMap((g) => {
      const mine = d.messages.lastOutgoingTs(g.id);
      if (mine !== null && mine >= cutoff) return [];
      return [{ chatId: g.id, title: g.title ?? g.id, kind: g.kind, action: 'leave' as const, lastMsgTs: g.lastMsgTs, myLastMsgTs: mine, unreadCount: g.unreadCount }];
    });
  const plan: CleanupPlan = { id: d.newId(), createdAt: now, expiresAt: now + PLAN_TTL_SEC, mode: 'remove', criteria: c, items, status: 'draft' };
  d.plans.insert(plan);
  return plan;
}

/// Plans live 30 minutes, so re-read the chat: it may have been promoted to `full` since.
async function leaveOne(d: ActionDeps, chatId: string): Promise<void> {
  if (d.chats.get(chatId)?.watchLevel === 'full') throw new AppError('FORBIDDEN', 'chat is now on full watch');
  try {
    await leaveGroup(d, chatId);
  } catch (e) {
    if (!(e instanceof AppError) || e.code !== 'RATE_LIMITED') throw e;
    // Paced loop: wait out the window once rather than failing the whole batch.
    await d.sleep((e.retryAfterSec ?? 1) * 1000);
    await leaveGroup(d, chatId);
  }
}

export async function cleanupApply(d: ActionDeps, planId: string, chatIds: string[]): Promise<{ left: string[]; failed: string[] }> {
  const plan = d.plans.get(planId);
  if (!plan) throw new AppError('NOT_FOUND', `unknown cleanup plan ${planId}`);
  if (plan.expiresAt <= d.now()) throw new AppError('VALIDATION', 'cleanup plan expired: create a new one');
  if (plan.status !== 'draft') throw new AppError('VALIDATION', 'cleanup plan already applied');

  const inPlan = new Set(plan.items.map((i) => i.chatId));
  const wanted = [...new Set(chatIds)];
  const result = { left: [] as string[], failed: wanted.filter((id) => !inPlan.has(id)) };
  const targets = wanted.filter((id) => inPlan.has(id));
  // Compare-and-set before any side effect, so two concurrent applies can't both leave.
  if (!d.plans.markApplied(planId)) throw new AppError('VALIDATION', 'cleanup plan already applied');

  for (const [index, chatId] of targets.entries()) {
    if (index > 0) await d.sleep(CLEANUP_CALL_GAP_MS);
    try {
      await leaveOne(d, chatId);
      result.left.push(chatId);
    } catch {
      result.failed.push(chatId);
    }
  }
  return result;
}
