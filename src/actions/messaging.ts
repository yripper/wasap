import { AppError } from '../domain/errors.js';
import type { MessageKeyRef } from '../store/types.js';
import { acquire, type ActionDeps, audited, requireChat } from './context.js';

function quotedKey(d: ActionDeps, chatId: string, replyToWaId: string | undefined): MessageKeyRef | undefined {
  if (replyToWaId === undefined) return undefined;
  const key = d.messages.keyOf(chatId, replyToWaId);
  if (!key) throw new AppError('NOT_FOUND', `message ${replyToWaId} is not in chat ${chatId}`);
  return key;
}

/// Sending also reads the chat (as the app does), so the reply doesn't leave the chat pending.
export async function sendMessage(
  d: ActionDeps,
  chatId: string,
  text: string,
  replyToWaId?: string,
): Promise<{ waId: string; markedRead: boolean }> {
  requireChat(d, chatId);
  const quoted = quotedKey(d, chatId, replyToWaId);
  acquire(d.limits.chatGap.tryAcquire(chatId));
  acquire(d.limits.sends.tryAcquire());
  // Captured before our own row goes in: it is what the user had not yet answered.
  const prior = d.messages.latestKey(chatId);
  const sent = await audited(d, 'send_message', chatId, () => d.gateway.sendText(chatId, text, quoted));
  // The message is already out, so a store failure must not look like a failed
  // send (that invites a duplicate); the live echo reconciles it.
  try {
    d.messages.insertMany([
      { chatId, waId: sent.waId, fromMe: true, senderJid: null, ts: sent.ts, text, mediaKind: null, quotedId: replyToWaId ?? null, sentViaWasap: true },
    ]);
  } catch {
    d.audit.record('send_message.store', chatId, 'error', d.now());
  }
  const markedRead = prior ? await tryMarkRead(d, chatId, prior) : false;
  return { waId: sent.waId, markedRead };
}

async function tryMarkRead(d: ActionDeps, chatId: string, last: MessageKeyRef): Promise<boolean> {
  try {
    await audited(d, 'mark_read', chatId, () => d.gateway.markRead(chatId, last));
    d.chats.applyUnread(chatId, { kind: 'live', value: 0 });
    return true;
  } catch {
    // Already audited as an error; the send itself succeeded.
    return false;
  }
}

/// No-op when the chat has no stored messages: there is nothing to mark.
export async function markRead(d: ActionDeps, chatId: string): Promise<void> {
  requireChat(d, chatId);
  const last = d.messages.latestKey(chatId);
  if (!last) return;
  await audited(d, 'mark_read', chatId, () => d.gateway.markRead(chatId, last));
  d.chats.applyUnread(chatId, { kind: 'live', value: 0 });
}
