import {
  Browsers,
  makeCacheableSignalKeyStore,
  makeWASocket,
  toNumber,
  type AuthenticationState,
  type BaileysEventMap,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from '@whiskeysockets/baileys';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Logger } from '../daemon/logger.js';
import { AppError, describeError } from '../domain/errors.js';
import { chatKind, toMuteMs } from './adapt.js';
import { useEncryptedAuthState } from './auth-state.js';
import { nextDelayMs } from './backoff.js';
import { ReconnectController } from './connection.js';
import { closeReason, guardEvents, mapChats, mapContacts, mapGroups, mapHistorySet, mapMessages } from './events.js';
import type { SessionCrypto } from './session-crypto.js';
import type { ConnectionState, MessageKeyRef, WaEvent, WhatsAppGateway } from './types.js';

export interface SocketDeps {
  auth: AuthenticationState;
  logger: Logger;
  getMessageText: (chatId: string, waId: string) => string | null;
}

/// Shared by the daemon and `wasap login`: history-related options must match at
/// pairing time, because the companion registration tells the phone how much history to send.
export function createSocket(d: SocketDeps): WASocket {
  // Baileys logs at debug/trace include full message objects; `warn` keeps them out.
  // A quieter parent (e.g. silent during login) stays quieter.
  const level = d.logger.levelVal > (d.logger.levels.values.warn ?? 40) ? d.logger.level : 'warn';
  const baileysLogger = d.logger.child({ module: 'baileys' }, { level });
  return makeWASocket({
    auth: { creds: d.auth.creds, keys: makeCacheableSignalKeyStore(d.auth.keys, baileysLogger) },
    logger: baileysLogger,
    // Stay "offline" so the phone keeps getting notifications and senders don't see us online.
    markOnlineOnConnect: false,
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
    // A desktop browser string makes the phone send the full history, not ~3 months.
    browser: Browsers.macOS('Desktop'),
    // Needed for retry receipts: the peer asks us to re-encrypt a message we sent.
    getMessage: async (key: WAMessageKey) => {
      const text = key.remoteJid && key.id ? d.getMessageText(key.remoteJid, key.id) : null;
      return text ? { conversation: text } : undefined;
    },
  });
}

export interface GatewayOptions {
  authDir: string;
  crypto: SessionCrypto;
  getMessageText: (chatId: string, waId: string) => string | null;
  logger: Logger;
}

type Auth = Awaited<ReturnType<typeof useEncryptedAuthState>>;

export class BaileysGateway implements WhatsAppGateway {
  private sock: WASocket | null = null;
  private current: ConnectionState = 'connecting';
  private readonly handlers: ((e: WaEvent) => void)[] = [];
  private readonly controller: ReconnectController;
  private stopped = false;

  private constructor(
    private readonly o: GatewayOptions,
    private readonly auth: Auth,
  ) {
    this.controller = new ReconnectController({
      connect: async () => this.connect(),
      // Unref: a pending retry must not keep a shutting-down process alive.
      sleep: (ms: number) => sleep(ms, undefined, { ref: false }),
      delay: (attempt: number) => nextDelayMs(attempt),
      onState: (s: ConnectionState) => this.setState(s),
    });
  }

  /// Resolves once the socket is created, not when it opens: the daemon must come
  /// up (and serve the store) even while WhatsApp is unreachable.
  static async start(o: GatewayOptions): Promise<BaileysGateway> {
    const auth = await useEncryptedAuthState(o.authDir, o.crypto);
    if (!auth.state.creds.me) throw new AppError('AUTH_REQUIRED', 'WhatsApp is not linked; run `wasap login` first');
    const gw = new BaileysGateway(o, auth);
    gw.connect();
    return gw;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.controller.stop();
    const sock = this.sock;
    this.sock = null;
    await sock?.end(undefined);
  }

  onEvent(h: (e: WaEvent) => void): void {
    this.handlers.push(h);
  }

  state(): ConnectionState {
    return this.current;
  }

  async sendText(chatId: string, text: string, quoted?: MessageKeyRef): Promise<{ waId: string; ts: number }> {
    const sock = this.openSocket();
    const sent = await sock.sendMessage(chatId, { text }, quoted ? { quoted: this.quotedMessage(chatId, quoted) } : undefined);
    if (!sent?.key.id) throw new AppError('INTERNAL', 'WhatsApp did not return the sent message');
    return { waId: sent.key.id, ts: toNumber(sent.messageTimestamp) };
  }

  async markRead(chatId: string, last: MessageKeyRef): Promise<void> {
    const sock = this.openSocket();
    const msg = minimalMessage(chatId, last);
    // chatModify clears the chat's unread badge on all devices; readMessages sends
    // the blue tick, which only makes sense for a message someone else sent.
    await sock.chatModify({ markRead: true, lastMessages: [msg] }, chatId);
    if (!last.fromMe) await sock.readMessages([msg.key]);
  }

  async setArchived(chatId: string, archived: boolean, last: MessageKeyRef): Promise<void> {
    await this.openSocket().chatModify({ archive: archived, lastMessages: [minimalMessage(chatId, last)] }, chatId);
  }

  /// Baileys forwards `mute` verbatim as the sync action's absolute `muteEndTimestamp`
  /// (Utils/chat-utils.ts): epoch ms, -1 = forever, null = unmute.
  async setMuted(chatId: string, untilSec: number | null): Promise<void> {
    await this.openSocket().chatModify({ mute: toMuteMs(untilSec) }, chatId);
  }

  async leaveGroup(chatId: string): Promise<void> {
    await this.openSocket().groupLeave(chatId);
  }

  async groupTitle(chatId: string): Promise<string | null> {
    const sock = this.openSocket();
    try {
      return (await sock.groupMetadata(chatId)).subject || null;
    } catch {
      return null;
    }
  }

  private openSocket(): WASocket {
    if (this.current === 'logged_out') throw new AppError('LOGGED_OUT', 'WhatsApp logged this device out; run `wasap login`');
    if (this.current !== 'open' || !this.sock) throw new AppError('INTERNAL', `WhatsApp is not connected (state: ${this.current})`);
    return this.sock;
  }

  /// Baileys builds the quote's contextInfo from `quoted.message`, so it must be
  /// non-empty; the stored text is used when we have it.
  private quotedMessage(chatId: string, q: MessageKeyRef): WAMessage {
    const text = this.o.getMessageText(chatId, q.waId);
    return { ...minimalMessage(chatId, q), message: { conversation: text ?? '' } };
  }

  private setState(s: ConnectionState): void {
    if (this.current === s) return;
    this.current = s;
    this.o.logger.info({ state: s }, 'whatsapp connection state');
    this.emit({ kind: 'connection', state: s });
  }

  private emit(e: WaEvent): void {
    for (const h of this.handlers) {
      try {
        h(e);
      } catch (err) {
        this.o.logger.error({ err: describeError(err), kind: e.kind }, 'whatsapp event handler failed');
      }
    }
  }

  private emitAll(events: WaEvent[]): void {
    for (const e of events) this.emit(e);
  }

  private connect(): void {
    if (this.stopped) return;
    const sock = createSocket({ auth: this.auth.state, logger: this.o.logger, getMessageText: this.o.getMessageText });
    this.sock = sock;
    const logError = (obj: { err: string }, msg: string): void => this.o.logger.error(obj, msg);
    // Three independently guarded steps: a failed creds write or a mapper bug must
    // neither crash the daemon nor make us miss a close (and thus a reconnect).
    const steps = [
      guardEvents(async (ev: Partial<BaileysEventMap>) => {
        if (ev['creds.update']) await this.auth.saveCreds();
      }, logError),
      guardEvents(async (ev: Partial<BaileysEventMap>) => this.handleData(ev), logError),
      guardEvents(async (ev: Partial<BaileysEventMap>) => {
        const conn = ev['connection.update'];
        if (conn) await this.handleConnection(sock, conn);
      }, logError),
    ];
    sock.ev.process(async (events: Partial<BaileysEventMap>) => {
      // A replaced socket can still flush buffered events; only the live one counts.
      if (sock !== this.sock) return;
      for (const step of steps) await step(events);
    });
  }

  private async handleData(ev: Partial<BaileysEventMap>): Promise<void> {
    const history = ev['messaging-history.set'];
    if (history) this.emitAll(mapHistorySet(history));
    if (ev['chats.upsert']) this.emitAll(mapChats(ev['chats.upsert'], 'history'));
    if (ev['chats.update']) this.emitAll(mapChats(ev['chats.update'], 'update'));
    if (ev['contacts.upsert']) this.emitAll(mapContacts(ev['contacts.upsert']));
    if (ev['contacts.update']) this.emitAll(mapContacts(ev['contacts.update']));
    // Both `notify` (live) and `append` (sent elsewhere / offline backlog) are real messages.
    const upsert = ev['messages.upsert'];
    if (upsert) this.emitAll(mapMessages(upsert.messages));
  }

  private async handleConnection(sock: WASocket, u: BaileysEventMap['connection.update']): Promise<void> {
    if (u.qr) this.o.logger.warn('whatsapp asked for a QR code; the session is no longer valid, run `wasap login`');
    if (u.connection === 'open') {
      this.controller.handleOpen();
      this.setState('open');
      // Not awaited: a slow group fetch must not hold up the event stream.
      void this.fetchGroupTitles(sock);
      return;
    }
    if (u.connection !== 'close' || this.stopped) return;
    const reason = closeReason(u.lastDisconnect?.error);
    this.o.logger.warn({ kind: reason.kind, code: reason.code, reason: reason.name }, 'whatsapp connection closed');
    if (reason.kind === 'terminal') {
      // Auth is kept: these are not logouts, and a human should look before retrying.
      this.sock = null;
      await this.controller.handleClose('terminal');
      return;
    }
    if (reason.kind === 'logged_out') {
      await this.controller.handleClose('logged_out');
      // End first so no pending creds.update can rewrite files after the wipe.
      this.sock = null;
      await sock.end(undefined);
      await this.auth.clear();
      return;
    }
    // Not awaited: the reconnect sleeps, and Baileys' event processing must not block on it.
    void this.controller.handleClose('other').catch((err: unknown) => {
      this.o.logger.error({ err: describeError(err) }, 'whatsapp reconnect failed');
    });
  }

  private async fetchGroupTitles(sock: WASocket): Promise<void> {
    try {
      this.emitAll(mapGroups(await sock.groupFetchAllParticipating()));
    } catch (err) {
      this.o.logger.warn({ err: describeError(err) }, 'could not fetch group titles');
    }
  }
}

/// `chatModify` and `readMessages` only need the key and timestamp (Types/Message.d.ts MinimalMessage).
function minimalMessage(chatId: string, m: MessageKeyRef): WAMessage {
  const isGroup = chatKind(chatId) === 'group';
  return {
    key: {
      remoteJid: chatId,
      id: m.waId,
      fromMe: m.fromMe,
      ...(isGroup && m.senderJid ? { participant: m.senderJid } : {}),
    },
    messageTimestamp: m.ts,
  };
}
