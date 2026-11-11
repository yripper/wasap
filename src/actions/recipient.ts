import { AppError } from '../domain/errors.js';
import type { ActionDeps } from './context.js';

const PN = '@s.whatsapp.net';
// Separators people type or paste in phone numbers.
const SEPARATORS = /[\s\-().]/g;
// E.164: country code plus subscriber number, at most 15 digits; 7 rules out typos like "123".
const PHONE = /^\+?(\d{7,15})$/;

/// Where a send goes: `id` keys the store, `waJid` addresses WhatsApp. `isNew`
/// means no chat exists yet, so the number must be checked with WhatsApp first.
export interface Recipient {
  id: string;
  waJid: string;
  isNew: boolean;
}

/// A JID passes through untouched; anything else must be a phone number with
/// country code, which becomes its `@s.whatsapp.net` JID.
export function normalizeRecipient(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('@')) return trimmed;
  const digits = PHONE.exec(trimmed.replace(SEPARATORS, ''))?.[1];
  if (!digits) throw new AppError('VALIDATION', `"${trimmed}" is neither a chat id nor a phone number with country code`);
  return `${digits}${PN}`;
}

/// Known chats resolve through aliases, so a phone number finds a chat stored
/// under its @lid. Only an unknown phone JID may become a new chat: an unknown
/// group or @lid can't be verified with WhatsApp, so it stays NOT_FOUND.
export function planRecipient(d: ActionDeps, input: string): Recipient {
  const jid = normalizeRecipient(input);
  const chat = d.chats.get(d.aliases.resolve(jid));
  if (chat) return { id: chat.id, waJid: chat.waJid, isNew: false };
  if (!jid.endsWith(PN)) throw new AppError('NOT_FOUND', `unknown chat ${jid}: use list_chats to find ids`);
  return { id: jid, waJid: jid, isNew: true };
}

/// Without this, Baileys would happily "send" to a number that has no account.
export async function confirmOnWhatsApp(d: ActionDeps, r: Recipient): Promise<void> {
  const found = await d.gateway.onWhatsApp(r.waJid);
  if (!found) throw new AppError('NOT_FOUND', `${r.waJid.slice(0, -PN.length)} is not on WhatsApp`);
}
