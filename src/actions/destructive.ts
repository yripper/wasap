import { AppError } from '../domain/errors.js';
import { acquire, type ActionDeps, audited, requireChat } from './context.js';

export async function leaveGroup(d: ActionDeps, chatId: string): Promise<void> {
  const chat = requireChat(d, chatId);
  if (chat.kind !== 'group') throw new AppError('VALIDATION', 'leave_group is for groups only');
  acquire(d.limits.destructive.tryAcquire());
  await audited(d, 'leave_group', chatId, () => d.gateway.leaveGroup(chat.waJid));
  // History stays searchable; muted just takes the chat out of pending.
  d.chats.setWatchLevel(chatId, 'muted');
}
