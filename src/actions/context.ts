import { AppError } from '../domain/errors.js';
import type { Acquire, PerKeyGap, RateLimiter } from '../domain/rate-limiter.js';
import type { AliasesRepo } from '../store/aliases-repo.js';
import type { AuditRepo } from '../store/audit-repo.js';
import type { ChatsRepo } from '../store/chats-repo.js';
import type { CleanupPlansRepo } from '../store/cleanup-plans-repo.js';
import type { MessagesRepo } from '../store/messages-repo.js';
import type { ChatRow } from '../store/types.js';
import type { Sink } from '../sync/sink.js';
import type { WhatsAppGateway } from '../whatsapp/types.js';

export interface ActionDeps {
  gateway: WhatsAppGateway;
  sink: Sink;
  chats: ChatsRepo;
  /** Lets a phone number find a chat stored under its @lid. */
  aliases: AliasesRepo;
  messages: MessagesRepo;
  audit: AuditRepo;
  plans: CleanupPlansRepo;
  limits: { sends: RateLimiter; chatGap: PerKeyGap; destructive: RateLimiter };
  /** Unix seconds. */
  now: () => number;
  newId: () => string;
  /// Injected so tests of paced loops (cleanup) run instantly.
  sleep: (ms: number) => Promise<void>;
}

export function acquire(r: Acquire): void {
  if (!r.ok) throw new AppError('RATE_LIMITED', 'Wasap rate limit reached', Math.ceil(r.retryAfterMs / 1000));
}

/// Audit rows are metadata only: action name, chat id and outcome. Never put text or titles in `action`.
export async function audited<T>(d: ActionDeps, action: string, chatId: string | null, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    d.audit.record(action, chatId, 'ok', d.now());
    return result;
  } catch (e) {
    d.audit.record(action, chatId, 'error', d.now());
    throw e;
  }
}

export function requireChat(d: ActionDeps, chatId: string): ChatRow {
  const chat = d.chats.get(chatId);
  if (!chat) throw new AppError('NOT_FOUND', `unknown chat ${chatId}: use list_chats to find ids`);
  return chat;
}
