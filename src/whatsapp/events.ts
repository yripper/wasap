import { DisconnectReason, type Chat, type Contact, type WAMessage } from '@whiskeysockets/baileys';
import { chatKind, skipChat, toContactPairs, toWaChat, toWaEvents } from './adapt.js';
import type { WaChat, WaEvent, WaMessage } from './types.js';

type AliasPair = { lid: string; pn: string };

/// The subset of Baileys' `messaging-history.set` payload wasap consumes (Types/Events.d.ts:18).
export interface HistorySetPayload {
  chats: Chat[];
  contacts: Contact[];
  messages: WAMessage[];
  lidPnMappings?: AliasPair[];
}

/// Plain messages from one batch become a single `messages` event so the store
/// can insert them in one transaction; edits and revokes keep their own events.
export function mapMessages(msgs: WAMessage[]): WaEvent[] {
  const plain: WaMessage[] = [];
  const other: WaEvent[] = [];
  for (const m of msgs) {
    for (const e of toWaEvents(m)) {
      if (e.kind === 'messages') plain.push(...e.messages);
      else other.push(e);
    }
  }
  return plain.length > 0 ? [{ kind: 'messages', messages: plain }, ...other] : other;
}

export function mapChats(chats: Partial<Chat>[], source: 'history' | 'update'): WaEvent[] {
  const mapped: WaChat[] = [];
  for (const c of chats) {
    if (!c.id || skipChat(c.id)) continue;
    mapped.push(toWaChat({ ...c, id: c.id }, source));
  }
  return mapped.length > 0 ? [{ kind: 'chats', chats: mapped }] : [];
}

/// Contact events only carry names (`name` = address book, `notify` = push name)
/// and the lid/pn pairs Baileys 7 attaches to them.
export function mapContacts(contacts: Partial<Contact>[]): WaEvent[] {
  const withId = contacts.filter((c): c is Contact => typeof c.id === 'string');
  const { contacts: named, aliases } = toContactPairs(withId);
  return [...aliasEvent(aliases), ...(named.length > 0 ? [{ kind: 'contacts' as const, contacts: named }] : [])];
}

/// Aliases go first so a consumer can resolve @lid chat ids before it stores
/// the chats and messages of the same batch.
export function mapHistorySet(p: HistorySetPayload): WaEvent[] {
  const fromChats = p.lidPnMappings ?? p.chats.flatMap(chatAlias);
  const { contacts: named, aliases: fromContacts } = toContactPairs(p.contacts);
  return [
    ...aliasEvent([...fromChats, ...fromContacts]),
    ...(named.length > 0 ? [{ kind: 'contacts' as const, contacts: named }] : []),
    ...mapChats(p.chats, 'history'),
    ...mapMessages(p.messages),
  ];
}

/// Group subjects from `groupFetchAllParticipating`; unread/archive/mute are
/// left unknown so this never overwrites state that came from history.
export function mapGroups(groups: Record<string, { id: string; subject: string }>): WaEvent[] {
  const chats: WaChat[] = Object.values(groups).map((g) => ({
    id: g.id,
    kind: chatKind(g.id),
    title: g.subject || null,
    unread: null,
    archived: null,
    mutedUntil: undefined,
  }));
  return chats.length > 0 ? [{ kind: 'chats', chats }] : [];
}

/// Baileys closes with a Boom error whose `output.statusCode` is a DisconnectReason.
export function closeReason(err: unknown): 'logged_out' | 'restart_required' | 'other' {
  const code = statusCodeOf(err);
  if (code === DisconnectReason.loggedOut) return 'logged_out';
  if (code === DisconnectReason.restartRequired) return 'restart_required';
  return 'other';
}

function statusCodeOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('output' in err)) return undefined;
  const output: unknown = err.output;
  if (typeof output !== 'object' || output === null || !('statusCode' in output)) return undefined;
  return typeof output.statusCode === 'number' ? output.statusCode : undefined;
}

function chatAlias(c: Chat): AliasPair[] {
  const id = c.id;
  if (!id) return [];
  const lid = c.lidJid ?? (id.endsWith('@lid') ? id : undefined);
  const pn = c.pnJid ?? (id.endsWith('@s.whatsapp.net') ? id : undefined);
  return lid && pn ? [{ lid, pn }] : [];
}

function aliasEvent(pairs: AliasPair[]): WaEvent[] {
  const seen = new Set<string>();
  const unique = pairs.filter((p) => {
    const k = `${p.lid}|${p.pn}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return unique.length > 0 ? [{ kind: 'aliases', pairs: unique }] : [];
}
