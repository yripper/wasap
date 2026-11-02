# Daemon Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/daemon/` · **Last verified:** 2026-11-03

## Purpose

Process-level plumbing: single-instance lock, logger, background loop, bearer token and connection snippets. Daemon wiring and the CLI are added by later tasks.

## Structure

| File | Purpose |
|---|---|
| `src/daemon/lock.ts` | `acquireLock`: pid lock file |
| `src/daemon/logger.ts` | `createLogger`: pino with redaction |
| `src/daemon/loop.ts` | `startNonOverlappingLoop` |
| `src/daemon/token.ts` | `ensureBearerToken` |
| `src/daemon/snippets.ts` | `connectionSnippets(port, token)` |

## Public surface

- `acquireLock(path, pid?)` (`lock.ts:18`): throws `INTERNAL` if a live process holds it; reclaims stale locks; `release()` only removes its own pid.
- `createLogger()` (`logger.ts:7`): level from `WASAP_LOG_LEVEL`, redacts `text`, `token`, `authKey`, `phone`, `authorization`.
- `startNonOverlappingLoop(task, intervalMs, onError, opts?)` (`loop.ts:5`): skips a tick while the previous run is in flight; returns a stop function.
- `ensureBearerToken(secrets)` (`token.ts:6`): reads or creates a 32-byte hex token in the Keychain.
- `connectionSnippets(port, token)` (`snippets.ts:1`): `claude mcp add` line and Claude Desktop `mcp-remote` JSON, server name `wasap`.

## Dependencies

- `src/secrets/keychain.ts`, `src/domain/errors.ts`, `pino`.

## Gotchas & invariants

- The lock prevents two processes on one WhatsApp session (the servers would replace one connection).
- Token is hex, not base64url: a leading `-` could be parsed as a flag by `security -i`.
- Never pass message text or secrets to the logger; redaction is only a safety net.

## Testing

- `pnpm test src/daemon`: temp dirs and fake timers.
