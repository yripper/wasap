import type { AliasesRepo } from '../store/aliases-repo.js';
import type { ChatsRepo } from '../store/chats-repo.js';
import type { ContactsRepo } from '../store/contacts-repo.js';
import type { Db } from '../store/db.js';
import type { MessagesRepo } from '../store/messages-repo.js';
import { chatKind } from '../whatsapp/adapt.js';
import type { ConnectionState, WaChat, WaEvent, WaMessage } from '../whatsapp/types.js';
import { chooseCanonical } from './canonical.js';

export interface SinkDeps {
  db: Db;
  chats: ChatsRepo;
  messages: MessagesRepo;
  aliases: AliasesRepo;
  contacts: ContactsRepo;
  now: () => number;
}

const LID = '@lid';
const PN = '@s.whatsapp.net';

/// Applies gateway events to the store. One transaction per event, so a throw
/// rolls the whole event back and propagates to the gateway's guard.
export class Sink {
  private lastAt: number | null = null;
  private conn: ConnectionState = 'connecting';

  constructor(private readonly d: SinkDeps) {}

  lastEventAt(): number | null {
    return this.lastAt;
  }

  connection(): ConnectionState {
    return this.conn;
  }

  apply(e: WaEvent): void {
    if (e.kind === 'connection') {
      this.conn = e.state;
      return;
    }
    this.d.db.transaction(() => this.dispatch(e))();
    this.lastAt = this.d.now();
  }

  private dispatch(e: Exclude<WaEvent, { kind: 'connection' }>): void {
    switch (e.kind) {
      case 'aliases':
        e.pairs.forEach((p) => this.linkAlias(p.lid, p.pn));
        return;
      case 'contacts':
        this.applyContacts(e.contacts);
        return;
      case 'chats':
        e.chats.forEach((c) => this.applyChat(c));
        return;
      case 'messages':
        this.applyMessages(e.messages);
        return;
      case 'edit':
        this.d.messages.editText(this.d.aliases.resolve(e.chatId), e.waId, e.text, e.ts);
        return;
      case 'revoke':
        this.d.messages.softDelete(this.d.aliases.resolve(e.chatId), e.waId, e.ts);
        return;
    }
  }

  /// Aliases stay flat: after this, lid and pn both point straight at one
  /// canonical, and everything that pointed at the loser follows it.
  private linkAlias(lid: string, pn: string): void {
    const { aliases, chats } = this.d;
    // Resolve first: either form may already be an alias of an earlier pair.
    const cl = aliases.resolve(lid);
    const cp = aliases.resolve(pn);
    if (cl !== cp) {
      const { canonical, mergeFrom } = chooseCanonical(cl, cp, { lid: chats.get(cl), pn: chats.get(cp) });
      const loser = canonical === cl ? cp : cl;
      if (mergeFrom) chats.mergeInto(mergeFrom, canonical);
      aliases.repoint(loser, canonical);
      this.d.messages.repointSender(loser, canonical);
      // Names may sit under the loser or either raw form; senders now join on the winner.
      for (const from of [loser, lid, pn]) this.d.contacts.copyIfMissing(from, canonical);
      aliases.add(lid, canonical);
      aliases.add(pn, canonical);
      return;
    }
    // Already one identity; make sure both raw forms point at it directly.
    aliases.add(lid, cl);
    aliases.add(pn, cl);
    for (const from of [lid, pn]) this.d.contacts.copyIfMissing(from, cl);
  }

  private applyContacts(contacts: { jid: string; name: string }[]): void {
    const { aliases, contacts: repo } = this.d;
    // Senders are stored canonical, so key the name under both forms.
    const all = contacts.flatMap((c) => {
      const canonical = aliases.resolve(c.jid);
      return canonical === c.jid ? [c] : [c, { jid: canonical, name: c.name }];
    });
    repo.upsertMany(all);
  }

  private applyChat(c: WaChat): void {
    const { chats, aliases, now } = this.d;
    const id = aliases.resolve(c.id);
    // c.id is the raw JID WhatsApp used for this chat; actions must address it that way.
    chats.upsert({ id, kind: c.kind, title: c.title ?? undefined, archived: c.archived ?? undefined, waJid: c.id }, now());
    if (c.mutedUntil !== undefined) chats.setWaMuted(id, c.mutedUntil);
    if (c.unread) chats.applyUnread(id, c.unread);
  }

  private applyMessages(batch: WaMessage[]): void {
    const { chats, aliases, messages, now } = this.d;
    for (const m of batch) this.linkSender(m);
    const rows = batch.map((m) => ({
      chatId: aliases.resolve(m.chatId),
      waId: m.waId,
      fromMe: m.fromMe,
      senderJid: m.senderJid === null ? null : aliases.resolve(m.senderJid),
      // Kept raw: WhatsApp needs the participant exactly as it sent it in message keys.
      senderWaJid: m.senderJid,
      ts: m.ts,
      text: m.text,
      mediaKind: m.mediaKind,
      quotedId: m.quotedId,
      sentViaWasap: false,
    }));
    // Messages are not chat-level events: the raw chat JID only seeds wa_jid for a brand-new chat.
    for (const m of batch) chats.upsert({ id: aliases.resolve(m.chatId), kind: chatKind(m.chatId), firstSeenAs: m.chatId }, now());
    messages.insertMany(rows);
  }

  /// A sender's two forms (exactly one @lid and one phone JID) are an alias pair.
  private linkSender(m: WaMessage): void {
    const { senderJid: a, senderAltJid: b } = m;
    if (a === null || b === null) return;
    if (a.endsWith(LID) && b.endsWith(PN)) this.linkAlias(a, b);
    else if (a.endsWith(PN) && b.endsWith(LID)) this.linkAlias(b, a);
  }
}
