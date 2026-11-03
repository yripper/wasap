import { AppError } from '../domain/errors.js';
import type { MessageKeyRef } from '../store/types.js';
import { type ActionDeps, audited, requireChat } from './context.js';

/// WhatsApp needs the newest message to anchor an archive change, so resolve
/// every key up front: a batch either has all it needs or touches nothing.
function keysFor(d: ActionDeps, chatIds: string[]): { chatId: string; waJid: string; last: MessageKeyRef }[] {
  return chatIds.map((chatId) => {
    const { waJid } = requireChat(d, chatId);
    const last = d.messages.latestKey(chatId);
    if (!last) throw new AppError('VALIDATION', `chat ${chatId} has no messages, so it cannot be archived or unarchived`);
    return { chatId, waJid, last };
  });
}

async function setArchivedAll(d: ActionDeps, chatIds: string[], archived: boolean): Promise<void> {
  const action = archived ? 'archive_chat' : 'unarchive_chat';
  for (const { chatId, waJid, last } of keysFor(d, chatIds)) {
    await audited(d, action, chatId, () => d.gateway.setArchived(waJid, archived, last));
    d.chats.setArchived(chatId, archived);
  }
}

export const archiveChats = (d: ActionDeps, chatIds: string[]): Promise<void> => setArchivedAll(d, chatIds, true);
export const unarchiveChats = (d: ActionDeps, chatIds: string[]): Promise<void> => setArchivedAll(d, chatIds, false);

/// `untilSec` null means forever, stored as -1 like the gateway expects.
export async function muteChat(d: ActionDeps, chatId: string, untilSec: number | null): Promise<void> {
  const { waJid } = requireChat(d, chatId);
  const value = untilSec ?? -1;
  await audited(d, 'mute_chat', chatId, () => d.gateway.setMuted(waJid, value));
  d.chats.setWaMuted(chatId, value);
}

export async function unmuteChat(d: ActionDeps, chatId: string): Promise<void> {
  const { waJid } = requireChat(d, chatId);
  await audited(d, 'unmute_chat', chatId, () => d.gateway.setMuted(waJid, null));
  d.chats.setWaMuted(chatId, null);
}
