import { randomUUID } from 'node:crypto';
import type { ActionDeps } from '../actions/context.js';
import type { Config, WatchLevel } from '../config/config.js';
import type { AppPaths } from '../config/paths.js';
import { AppError, describeError } from '../domain/errors.js';
import { PerKeyGap, RateLimiter } from '../domain/rate-limiter.js';
import { startHttpServer } from '../mcp/http.js';
import { buildInstructions, readStyleGuide } from '../mcp/instructions.js';
import { buildServer, type StatusReport, type ToolDeps } from '../mcp/server.js';
import type { SecretStore } from '../secrets/keychain.js';
import { AliasesRepo } from '../store/aliases-repo.js';
import { AuditRepo } from '../store/audit-repo.js';
import { ChatsRepo } from '../store/chats-repo.js';
import { CleanupPlansRepo } from '../store/cleanup-plans-repo.js';
import { ContactsRepo } from '../store/contacts-repo.js';
import { openDb, type Db } from '../store/db.js';
import { MessagesRepo } from '../store/messages-repo.js';
import { listPending } from '../store/pending-query.js';
import type { ChatKind } from '../store/types.js';
import { VoiceRepo } from '../store/voice-repo.js';
import { Sink } from '../sync/sink.js';
import type { WhatsAppGateway } from '../whatsapp/types.js';
import { acquireLock } from './lock.js';
import type { Logger } from './logger.js';
import { ensureBearerToken } from './token.js';
import { createUnlinkedGateway } from './unlinked-gateway.js';

/// What the daemon hands the gateway factory: stored text for retry receipts and quotes.
export interface GatewayContext {
  getMessageText: (chatId: string, waId: string) => string | null;
}

export interface DaemonOptions {
  paths: AppPaths;
  config: Config;
  secrets: SecretStore;
  logger: Logger;
  /// Throws AppError('AUTH_REQUIRED') when no device is linked; the daemon then serves unlinked.
  gatewayFactory: (ctx: GatewayContext) => Promise<WhatsAppGateway>;
}

export interface RunningDaemon {
  port: number;
  stop(): Promise<void>;
}

// pm2's kill_timeout is 10 s; exit on our own just before it so a hung close
// can't leave the process half-dead.
const HARD_EXIT_MS = 8000;
// Pending is a handful of chats in practice; the cap only bounds a pathological store.
const PENDING_COUNT_CAP = 100_000;

const nowSec = (): number => Math.floor(Date.now() / 1000);
const isoOrNull = (sec: number | null): string | null => (sec === null ? null : new Date(sec * 1000).toISOString());

/// Lock, DB, gateway, HTTP, in that order. Every resource opened so far is
/// released if a later step fails, so a failed start never leaves the lock held.
export async function startDaemon(o: DaemonOptions): Promise<RunningDaemon> {
  const lock = acquireLock(o.paths.lock);
  let db: Db | null = null;
  let gateway: WhatsAppGateway | null = null;
  try {
    const token = await ensureBearerToken(o.secrets);
    db = openDb(o.paths.db);
    const store = openStore(db, o.config);
    gateway = await startGateway(o, store);
    gateway.onEvent((e) => store.sink.apply(e));
    const deps = toolDeps(db, store, gateway, o.config);
    const http = await startHttpServer({
      port: o.config.port,
      token,
      log: (line: string) => o.logger.warn(line),
      // style.md is re-read per request so edits apply without a restart.
      buildServer: () => buildServer(deps, buildInstructions(readStyleGuide(o.paths.style))),
    });
    o.logger.info({ port: http.port, connection: gateway.state() }, 'wasap listening on 127.0.0.1');
    return { port: http.port, stop: once(() => shutdown(o.logger, http, gateway, db, lock)) };
  } catch (e) {
    await gateway?.stop().catch(() => undefined);
    db?.close();
    lock.release();
    throw e;
  }
}

interface Store {
  chats: ChatsRepo;
  messages: MessagesRepo;
  aliases: AliasesRepo;
  contacts: ContactsRepo;
  sink: Sink;
}

function openStore(db: Db, config: Config): Store {
  const defaultWatch = (kind: ChatKind): WatchLevel => (kind === 'group' ? config.watchDefaults.group : 'normal');
  const chats = new ChatsRepo(db, defaultWatch);
  const messages = new MessagesRepo(db);
  const aliases = new AliasesRepo(db);
  const contacts = new ContactsRepo(db);
  const sink = new Sink({ db, chats, messages, aliases, contacts, now: nowSec });
  return { chats, messages, aliases, contacts, sink };
}

async function startGateway(o: DaemonOptions, store: Store): Promise<WhatsAppGateway> {
  // Baileys may ask about a message by its @lid chat id while the store keys by canonical.
  const getMessageText = (chatId: string, waId: string): string | null => store.messages.getText(store.aliases.resolve(chatId), waId);
  try {
    return await o.gatewayFactory({ getMessageText });
  } catch (e) {
    if (!(e instanceof AppError && e.code === 'AUTH_REQUIRED')) throw e;
    // Not linked must not exit: pm2 would crash-loop. Serve the store and status instead.
    o.logger.warn('WhatsApp is not linked: run `pm2 stop wasap && wasap login && pm2 start wasap`');
    return createUnlinkedGateway();
  }
}

function toolDeps(db: Db, store: Store, gateway: WhatsAppGateway, config: Config): ToolDeps {
  const actions: ActionDeps = {
    gateway,
    sink: store.sink,
    chats: store.chats,
    messages: store.messages,
    audit: new AuditRepo(db),
    plans: new CleanupPlansRepo(db),
    limits: {
      sends: new RateLimiter(config.sendsPerMinute, 60_000),
      chatGap: new PerKeyGap(config.perChatSendGapMs),
      destructive: new RateLimiter(config.destructivePerMinute, 60_000),
    },
    now: nowSec,
    newId: () => randomUUID(),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
  const count = (table: 'chats' | 'messages'): number => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  const status = (): StatusReport => ({
    connection: gateway.state(),
    lastEventAt: isoOrNull(store.sink.lastEventAt()),
    chats: count('chats'),
    messages: count('messages'),
    pending: listPending(db, nowSec(), PENDING_COUNT_CAP).length,
  });
  return { actions, db, voice: new VoiceRepo(db), contacts: store.contacts, status };
}

/// Stop taking requests first so nothing reaches a closing gateway or DB, then
/// let Baileys end the socket and flush creds, then close the DB, then unlock.
async function shutdown(
  log: Logger,
  http: { close(): Promise<void> },
  gateway: WhatsAppGateway | null,
  db: Db | null,
  lock: { release(): void },
): Promise<void> {
  try {
    await http.close().catch((e: unknown) => log.warn(`http close failed: ${describeError(e)}`));
    await gateway?.stop().catch((e: unknown) => log.warn(`gateway stop failed: ${describeError(e)}`));
    db?.close();
  } finally {
    lock.release();
  }
}

function once(fn: () => Promise<void>): () => Promise<void> {
  let p: Promise<void> | null = null;
  return () => (p ??= fn());
}

/// For `wasap start` only: SIGTERM (pm2) and SIGINT (Ctrl-C) stop the daemon
/// once, with a hard exit before pm2's kill_timeout in case a close hangs.
export function exitOnSignals(d: RunningDaemon, log: Logger): void {
  let stopping = false;
  const onSignal = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal}: shutting down`);
    setTimeout(() => process.exit(1), HARD_EXIT_MS).unref();
    d.stop().then(
      () => process.exit(0),
      (e: unknown) => {
        log.error(`shutdown failed: ${describeError(e)}`);
        process.exit(1);
      },
    );
  };
  // `on`, not `once`: a second signal mid-shutdown must be ignored, not kill us
  // with the default handler before creds are flushed.
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
}
