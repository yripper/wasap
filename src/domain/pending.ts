import type { ChatRow } from '../store/types.js';

export type PendingReason = 'marked_unread' | 'unread';

/// What makes a chat "waiting on me". Unread-driven because WhatsApp has no
/// reliable "last reply" signal. WhatsApp's own mute (`waMutedUntil`) is
/// deliberately ignored: a muted chat can still be one I owe a reply.
/// Keep in sync with the SQL in src/store/pending-query.ts.
export function pendingReason(c: ChatRow, nowSec: number): PendingReason | null {
  if (c.archived || c.watchLevel === 'muted') return null;
  if (c.snoozeUntil !== null && c.snoozeUntil > nowSec) return null;
  if (c.markedUnread) return 'marked_unread';
  // Unread in a group is normal noise unless I put it on full watch.
  if (c.unreadCount > 0 && (c.kind === 'dm' || c.watchLevel === 'full')) return 'unread';
  return null;
}
