import { AppError } from '../domain/errors.js';
import type { MessageKeyRef } from '../store/types.js';
import { acquire, type ActionDeps, audited, requireChat } from './context.js';
import { confirmOnWhatsApp, planRecipient } from './recipient.js';

function quotedKey(d: ActionDeps, chatId: string, replyToWaId: string | undefined): MessageKeyRef | undefined {
  if (replyToWaId === undefined) return undefined;
  const key = d.messages.keyOf(chatId, replyToWaId);
  if (!key) throw new AppError('NOT_FOUND', `message ${replyToWaId} is not in chat ${chatId}`);
  return key;
}

/// Sending also reads the chat (as the app does), so the reply doesn't leave the chat pending.
/// `to` is a chat id or a phone number; a number with no chat yet is checked with
/// WhatsApp first and becomes a chat once the message is out. `chatId` in the
/// result is the store id to use with the other tools.
export async function sendMessage(
  d: ActionDeps,
  to: string,
  text: string,
  replyToWaId?: string,
): Promise<{ chatId: string; waId: string; markedRead: boolean }> {
  const target = planRecipient(d, to);
  const chatId = target.id;
  const quoted = quotedKey(d, chatId, replyToWaId);
  // Before the lookup, so checking numbers is paced like sending to them.
  acquire(d.limits.chatGap.tryAcquire(chatId));
  acquire(d.limits.sends.tryAcquire());
  if (target.isNew) await confirmOnWhatsApp(d, target);
  // Captured before our own row goes in: it is what the user had not yet answered.
  const prior = d.messages.latestKey(chatId);
  const sent = await audited(d, 'send_message', chatId, () => d.gateway.sendText(target.waJid, text, quoted));
  // The message is already out, so a store failure must not look like a failed
  // send (that invites a duplicate); the live echo reconciles it.
  try {
    // firstSeenAs, not waJid: if the echo already created the chat, its JID wins.
    if (target.isNew) d.chats.upsert({ id: chatId, kind: 'dm', firstSeenAs: target.waJid }, d.now());
    d.messages.insertMany([
      { chatId, waId: sent.waId, fromMe: true, senderJid: null, ts: sent.ts, text, mediaKind: null, quotedId: replyToWaId ?? null, sentViaWasap: true },
    ]);
  } catch {
    d.audit.record('send_message.store', chatId, 'error', d.now());
  }
  const markedRead = prior ? await tryMarkRead(d, chatId, target.waJid, prior) : false;
  return { chatId, waId: sent.waId, markedRead };
}

async function tryMarkRead(d: ActionDeps, chatId: string, waJid: string, last: MessageKeyRef): Promise<boolean> {
  try {
    await audited(d, 'mark_read', chatId, () => d.gateway.markRead(waJid, last));
    d.chats.applyUnread(chatId, { kind: 'live', value: 0 });
    return true;
  } catch {
    // Already audited as an error; the send itself succeeded.
    return false;
  }
}

/// False (and no WhatsApp call) when the chat has no stored messages: WhatsApp
/// needs a message to anchor the read on.
export async function markRead(d: ActionDeps, chatId: string): Promise<boolean> {
  const chat = requireChat(d, chatId);
  const last = d.messages.latestKey(chatId);
  if (!last) return false;
  await audited(d, 'mark_read', chatId, () => d.gateway.markRead(chat.waJid, last));
  d.chats.applyUnread(chatId, { kind: 'live', value: 0 });
  return true;
}
