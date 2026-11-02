# Domain Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/domain/` · **Last verified:** 2026-11-03

## Purpose

Pure logic with no I/O: the shared error type and rate limiting. Later tasks add pending-status and cleanup logic here.

## Structure

| File | Purpose |
|---|---|
| `src/domain/errors.ts` | `ErrorCode`, `AppError`, `describeError` |
| `src/domain/rate-limiter.ts` | `RateLimiter` (sliding window), `PerKeyGap` (per-JID minimum gap) |

## Public surface

- `ErrorCode` (`errors.ts:1`): `NOT_FOUND`, `FLOOD_WAIT`, `FORBIDDEN`, `AUTH_REQUIRED`, `LOGGED_OUT`, `VALIDATION`, `RATE_LIMITED`, `INTERNAL`.
- `AppError` (`errors.ts:14`): `code`, message, optional `retryAfterSec`.
- `describeError(e)` (`errors.ts:27`): log-safe `CODE: message`.
- `RateLimiter` (`rate-limiter.ts:6`): `tryAcquire()` returns `{ ok: true }` or `{ ok: false, retryAfterMs }`.
- `PerKeyGap` (`rate-limiter.ts:27`): `tryAcquire(key: string)`, keys are JIDs.

## Dependencies

- None.

## Gotchas & invariants

- `AppError` messages must never contain message text, phone numbers or secrets.
- Rejected attempts are not recorded by `RateLimiter`.
- Callers turn a rejection into `RATE_LIMITED` instead of sleeping.

## Testing

- `pnpm test src/domain`: injected clocks, no timers.
