# Domain Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/domain/` · **Last verified:** 2026-11-03

## Purpose

Pure logic with no I/O: the shared error type, rate limiting and the pending rule. Later tasks add cleanup logic here.

## Structure

| File | Purpose |
|---|---|
| `src/domain/errors.ts` | `ErrorCode`, `AppError`, `describeError` |
| `src/domain/pending.ts` | `PendingReason`, `pendingReason` |
| `src/domain/rate-limiter.ts` | `RateLimiter` (sliding window), `PerKeyGap` (per-JID minimum gap) |

## Public surface

- `ErrorCode` (`errors.ts:1`): `NOT_FOUND`, `FLOOD_WAIT`, `FORBIDDEN`, `AUTH_REQUIRED`, `LOGGED_OUT`, `VALIDATION`, `RATE_LIMITED`, `INTERNAL`.
- `AppError` (`errors.ts:14`): `code`, message, optional `retryAfterSec`.
- `describeError(e)` (`errors.ts:27`): log-safe `CODE: message`.
- `RateLimiter` (`rate-limiter.ts:6`): `tryAcquire()` returns `{ ok: true }` or `{ ok: false, retryAfterMs }`.
- `PerKeyGap` (`rate-limiter.ts:27`): `tryAcquire(key: string)`, keys are JIDs.
- `pendingReason(c, nowSec)` (`pending.ts:11`): `null` if archived, watch `muted` or snoozed (`snoozeUntil > nowSec`); else `'marked_unread'` if `markedUnread`; else `'unread'` if `unreadCount > 0` and (DM or watch `full`); else `null`.

## Dependencies

- Type-only import of `ChatRow` from `src/store/types.ts` (`pending.ts`).

## Gotchas & invariants

- `AppError` messages must never contain message text, phone numbers or secrets.
- **Pending is unread-driven** and has a SQL twin in `src/store/pending-query.ts`; change both together. `waMutedUntil` is ignored on purpose. Snooze expires at `snoozeUntil <= nowSec`.
- Rejected attempts are not recorded by `RateLimiter`.
- Callers turn a rejection into `RATE_LIMITED` instead of sleeping.

## Testing

- `pnpm test src/domain`: injected clocks, no timers. `pending.test.ts` covers each rule branch.
