# Daemon Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/daemon/`, `src/cli.ts`, `ecosystem.config.cjs` · **Last verified:** 2026-11-03

## Purpose

Process-level plumbing and wiring: single-instance lock, logger, background loop, bearer token, connection snippets, `startDaemon` (lock + DB + gateway + sink + MCP HTTP), the unlinked gateway stub, the `wasap` CLI and the pm2 app definition.

## Structure

| File | Purpose |
|---|---|
| `src/daemon/lock.ts` | `acquireLock`: pid lock file |
| `src/daemon/logger.ts` | `createLogger`: pino with redaction |
| `src/daemon/loop.ts` | `startNonOverlappingLoop` |
| `src/daemon/token.ts` | `ensureBearerToken` |
| `src/daemon/snippets.ts` | `connectionSnippets(port, token)` |
| `src/daemon/daemon.ts` | `startDaemon`, `exitOnSignals` |
| `src/daemon/unlinked-gateway.ts` | `createUnlinkedGateway`: stand-in gateway when no device is linked |
| `src/cli.ts` | `wasap login [--force] / start / token / logout` |
| `ecosystem.config.cjs` | pm2 app `wasap` running `dist/cli.js start` |

## Public surface

- `acquireLock(path, pid?)` (`lock.ts:18`): throws `INTERNAL` ("wasap is already running … pm2 stop wasap") if a live process holds it; reclaims stale locks; `release()` only removes its own pid.
- `createLogger()` (`logger.ts:7`): level from `WASAP_LOG_LEVEL`, redacts `text`, `token`, `authKey`, `phone`, `authorization`.
- `startNonOverlappingLoop(task, intervalMs, onError, opts?)` (`loop.ts:5`): skips a tick while the previous run is in flight; returns a stop function.
- `ensureBearerToken(secrets)` (`token.ts:6`): reads or creates a 32-byte hex token in the Keychain.
- `connectionSnippets(port, token)` (`snippets.ts:1`): `claude mcp add` line and Claude Desktop `mcp-remote` JSON, server name `wasap`.
- `startDaemon({ paths, config, secrets, logger, gatewayFactory })` (`daemon.ts:58`) resolves `RunningDaemon { port, stop() }` (`daemon.ts:42`). `gatewayFactory(ctx: GatewayContext)` (`daemon.ts:29`) receives `{ getMessageText }`; a factory that ignores it (tests) is fine.
- `exitOnSignals(daemon, log)` (`daemon.ts:170`): used only by `wasap start`.
- `createUnlinkedGateway()` (`unlinked-gateway.ts:9`): `state()` is `'logged_out'`, every WhatsApp call rejects `AppError('LOGGED_OUT', NOT_LINKED)`, `onEvent`/`stop` are no-ops.

### CLI (`src/cli.ts`)

- `login [--force]` (`cli.ts:34`): takes the lock; refuses (exit 1) if already linked unless `--force`, which clears the auth dir first; runs `runLogin`, then `ensureBearerToken`. Never prints the account id.
- `start` (`cli.ts:54`): `startDaemon` with the real Keychain and a factory calling `BaileysGateway.start`, then `exitOnSignals`; logs `unhandledRejection` instead of dying.
- `token` (`cli.ts:73`): prints `connectionSnippets` for the configured port.
- `logout` (`cli.ts:79`): takes the lock (so it refuses while the daemon runs), `runLogout`, keeps the DB.

## Key methods

- `startDaemon` order: `acquireLock` → `ensureBearerToken` → `openDb` → repos + `Sink` (`openStore`, `daemon.ts:94`) → gateway (`startGateway`, `daemon.ts:104`) → `gateway.onEvent(sink.apply)` → `startHttpServer` with a fresh `buildServer` per request (style guide re-read per request). Any failure after the lock stops the gateway, closes the DB and releases the lock before rethrowing.
- `startGateway`: the `getMessageText` handed to the factory resolves aliases first (`messages.getText(aliases.resolve(chatId), waId)`), because Baileys may ask with an `@lid` while the store keys by canonical. `AppError('AUTH_REQUIRED')` from the factory (no `creds.me`) switches to `createUnlinkedGateway` and logs a warn; any other error is fatal.
- `ChatsRepo` default watch (`daemon.ts:95`): DMs `normal`, groups `config.watchDefaults.group`.
- `status` (`toolDeps`, `daemon.ts:117`): `connection` = `gateway.state()`, `lastEventAt` = `sink.lastEventAt()` as ISO or `null`, `chats`/`messages` = row counts, `pending` = `listPending(...).length` (capped at 100 000).
- `shutdown` (`daemon.ts:147`): HTTP close → `gateway.stop()` → `db.close()` → lock release (in `finally`). `stop()` is memoized (`once`), so a second call waits on the first.
- `exitOnSignals`: SIGTERM and SIGINT both registered with `on`; the first signal stops the daemon, later ones are ignored. A hard `process.exit(1)` timer (8 s, unref'd) fires before pm2's `kill_timeout` (10 s).

## Dependencies

- `src/secrets/keychain.ts`, `src/domain/errors.ts`, `src/domain/rate-limiter.ts`, `src/config/*`, `src/store/*`, `src/sync/sink.ts`, `src/mcp/{http,server,instructions}.ts`, `src/actions/context.ts` (type), `src/whatsapp/types.ts` (type), `pino`.
- `src/cli.ts` additionally uses `src/whatsapp/{gateway,login,session-crypto}.ts`. `daemon.ts` itself never imports Baileys-backed modules, so its test runs without network.

## Gotchas & invariants

- The lock prevents two processes on one WhatsApp session (WhatsApp would replace one connection). `login` and `logout` take it too.
- Not linked must not exit: under pm2 that is a crash loop. The daemon serves the store, `status` reports `logged_out`, WhatsApp tools return `LOGGED_OUT`.
- `BaileysGateway.start` resolves before the socket opens, so HTTP comes up without waiting on WhatsApp.
- `kill_timeout: 10000` in `ecosystem.config.cjs` lets Baileys close the socket and flush creds.
- Token is hex, not base64url: a leading `-` could be parsed as a flag by `security -i`.
- Never pass message text or secrets to the logger; redaction is only a safety net.
- `config.port` is used as given by `startDaemon`; tests pass `0` (ephemeral) even though the config schema requires 1024+.

## Testing

- `pnpm test src/daemon`: temp dirs and fake timers. `daemon.test.ts` runs `startDaemon` with `FakeGateway`, `MemorySecretStore`, a temp `WASAP_HOME`, port 0 and a real MCP HTTP client: events reach `status`, `stop()` releases the lock and stops the gateway, a held lock refuses start, the unlinked path reports `logged_out`, a failed start releases the lock, and `getMessageText` resolves `@lid` aliases. `unlinked-gateway.test.ts` covers the stub.
- `src/cli.ts` is not unit-tested; it is verified in the live run.
