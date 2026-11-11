import type { ActionDeps } from '../actions/context.js';
import { PerKeyGap, RateLimiter } from '../domain/rate-limiter.js';
import { AliasesRepo } from '../store/aliases-repo.js';
import { AuditRepo } from '../store/audit-repo.js';
import { ChatsRepo } from '../store/chats-repo.js';
import { CleanupPlansRepo } from '../store/cleanup-plans-repo.js';
import { ContactsRepo } from '../store/contacts-repo.js';
import { openDb, type Db } from '../store/db.js';
import { MessagesRepo } from '../store/messages-repo.js';
import { Sink } from '../sync/sink.js';
import { FakeGateway } from './fake-gateway.js';

export function makeActionDeps(over: { sendsPerMinute?: number; destructivePerMinute?: number } = {}): {
  deps: ActionDeps;
  gateway: FakeGateway;
  db: Db;
  chats: ChatsRepo;
  messages: MessagesRepo;
  audit: AuditRepo;
  clock: { ms: number };
  sleeps: number[];
} {
  const db = openDb(':memory:');
  const chats = new ChatsRepo(db, () => 'normal');
  const messages = new MessagesRepo(db);
  const gateway = new FakeGateway();
  const aliases = new AliasesRepo(db);
  // ~115 days after the epoch, so "inactive for N days" criteria have room to match.
  const clock = { ms: 10_000_000_000 };
  const nowMs = (): number => clock.ms;
  const nowSec = (): number => Math.floor(clock.ms / 1000);
  const audit = new AuditRepo(db);
  let ids = 0;
  const sleeps: number[] = [];
  const deps: ActionDeps = {
    gateway,
    sink: new Sink({ db, chats, messages, aliases, contacts: new ContactsRepo(db), now: nowSec }),
    chats,
    aliases,
    messages,
    audit,
    plans: new CleanupPlansRepo(db),
    limits: {
      sends: new RateLimiter(over.sendsPerMinute ?? 20, 60_000, nowMs),
      chatGap: new PerKeyGap(1000, nowMs),
      destructive: new RateLimiter(over.destructivePerMinute ?? 30, 60_000, nowMs),
    },
    now: nowSec,
    newId: () => `plan-${++ids}`,
    // Records instead of waiting, so paced loops stay fast and assertable.
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
  return { deps, gateway, db, chats, messages, audit, clock, sleeps };
}
