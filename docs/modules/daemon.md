# Daemon Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/daemon/`, `src/cli.ts`, `ecosystem.config.cjs` · **Last verified:** 2026-11-06

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
- `createLogger(dest?)` (`logger.ts:9`): level from `WASAP_LOG_LEVEL`, redacts `text`, `token`, `authKey`, `phone`, `authorization`. `base: undefined` drops pino's default `pid` and `hostname` (a Mac's hostname usually carries the owner's name into pm2 logs). `dest` is for tests.
- `startNonOverlappingLoop(task, intervalMs, onError, opts?)` (`loop.ts:5`): skips a tick while the previous run is in flight; returns a stop function.
- `ensureBearerToken(secrets)` (`token.ts:6`): reads or creates a 32-byte hex token in the secret store.
- `connectionSnippets(port, token)` (`snippets.ts:1`): `claude mcp add` line and Claude Desktop `mcp-remote` JSON, server name `wasap`.
- `startDaemon({ paths, config, secrets, logger, gatewayFactory })` (`daemon.ts:58`) resolves `RunningDaemon { port, stop() }` (`daemon.ts:42`). `gatewayFactory(ctx: GatewayContext)` (`daemon.ts:29`) receives `{ getMessageText }`; a factory that ignores it (tests) is fine.
- `exitOnSignals(daemon, log)` (`daemon.ts:171`): used only by `wasap start`.
- `createUnlinkedGateway(reason?)` (`unlinked-gateway.ts:10`): `state()` is `'logged_out'`, every WhatsApp call rejects `AppError('LOGGED_OUT', reason)` (default `NOT_LINKED`; the daemon passes the factory's message), `onEvent`/`stop` are no-ops.

### CLI (`src/cli.ts`)

- `login [--force]` (`cli.ts:34`): takes the lock; `prepareLogin` decides: without `--force` it refuses (exit 1) a linked session, and an unreadable one with a message pointing at `--force`; `--force` wipes the auth dir with plain fs (no decryption), so it also recovers an undecryptable session, and tells the user to remove the old device from the phone's Linked devices. Then `runLogin` and `ensureBearerToken`. Never prints the account id.
- `start` (`cli.ts:57`): `startDaemon` with `createSecretStore()` (Keychain on macOS, `secret-tool` keyring on Linux; every command uses it) and a factory calling `BaileysGateway.start`, then `exitOnSignals`; logs `unhandledRejection` instead of dying.
- `token` (`cli.ts:76`): prints `connectionSnippets` for the configured port.
- `logout` (`cli.ts:82`): takes the lock (so it refuses while the daemon runs), `runLogout`, keeps the DB.

## Key methods

- `startDaemon` order: `acquireLock` → `ensureBearerToken` → `openDb` → repos + `Sink` (`openStore`, `daemon.ts:94`) → gateway (`startGateway`, `daemon.ts:104`) → `gateway.onEvent(sink.apply)` → `startHttpServer` with a fresh `buildServer` per request (style guide re-read per request). Any failure after the lock stops the gateway, closes the DB and releases the lock before rethrowing.
- `startGateway`: the `getMessageText` handed to the factory resolves aliases first (`messages.getText(aliases.resolve(chatId), waId)`), because Baileys may ask with an `@lid` while the store keys by canonical. `AppError('AUTH_REQUIRED')` from the factory switches to `createUnlinkedGateway(e.message)` and logs one warn line (`whatsapp unavailable: <describeError>`); any other error is fatal. `BaileysGateway.start` throws `AUTH_REQUIRED` both when never linked and when the session can't be decrypted, so a changed secret-store key or corrupted creds never crash-loops pm2; the unreadable files are left untouched.
- `ChatsRepo` default watch (`daemon.ts:95`): DMs `normal`, groups `config.watchDefaults.group`.
- `status` (`toolDeps`, `daemon.ts:118`): `connection` = `gateway.state()`, `lastEventAt` = `sink.lastEventAt()` as ISO or `null`, `chats`/`messages` = row counts, `pending` = `listPending(...).length` (capped at 100 000).
- `shutdown` (`daemon.ts:148`): HTTP close → `gateway.stop()` → `db.close()` → lock release (in `finally`). `stop()` is memoized (`once`), so a second call waits on the first.
- `exitOnSignals`: SIGTERM and SIGINT both registered with `on`; the first signal stops the daemon, later ones are ignored. A hard `process.exit(1)` timer (8 s, unref'd) fires before pm2's `kill_timeout` (10 s).

## Dependencies

- `src/secrets/keychain.ts` (types), `src/domain/errors.ts`, `src/domain/rate-limiter.ts`, `src/config/*`, `src/store/*`, `src/sync/sink.ts`, `src/mcp/{http,server,instructions}.ts`, `src/actions/context.ts` (type), `src/whatsapp/types.ts` (type), `pino`.
- `src/cli.ts` additionally uses `src/secrets/store.ts` and `src/whatsapp/{gateway,login,session-crypto}.ts`. `daemon.ts` itself never imports Baileys-backed modules. Its test imports `BaileysGateway` only for the unreadable-session case, which throws before any socket is created (no network).

## Gotchas & invariants

- The lock prevents two processes on one WhatsApp session (WhatsApp would replace one connection). `login` and `logout` take it too.
- Not linked or unreadable must not exit: under pm2 that is a crash loop. The daemon serves the store, `status` reports `logged_out`, WhatsApp tools return `LOGGED_OUT` with the reason (`login` vs `login --force`). It never starts from blank creds over unreadable files.
- `BaileysGateway.start` resolves before the socket opens, so HTTP comes up without waiting on WhatsApp.
- `kill_timeout: 10000` in `ecosystem.config.cjs` lets Baileys close the socket and flush creds.
- Token is hex, not base64url: a leading `-` could be parsed as a flag by `security -i`.
- Platform: the daemon is plain Node plus pm2 and runs the same on macOS and Linux (verified 2026-11-06 on Ubuntu 24.04: tests, build). The only OS-specific piece is the secret store. On Linux the pm2 process needs the D-Bus session of an unlocked keyring; a daemon brought up by `pm2 startup` at boot can't read secrets until it's restarted from a session that has one (README "Linux").
- Never pass message text or secrets to the logger; redaction is only a safety net.
- `config.port` is used as given by `startDaemon`; tests pass `0` (ephemeral) even though the config schema requires 1024+.

## Testing

- `pnpm test src/daemon`: temp dirs and fake timers. `daemon.test.ts` runs `startDaemon` with `FakeGateway`, `MemorySecretStore`, a temp `WASAP_HOME`, port 0 and a real MCP HTTP client: events reach `status`, `stop()` releases the lock and stops the gateway, a held lock refuses start, the unlinked path reports `logged_out`, a failed start releases the lock, `getMessageText` resolves `@lid` aliases, and an auth dir encrypted under another key serves `logged_out`, makes `send_message` fail with `LOGGED_OUT … login --force`, and leaves the files byte-identical. `unlinked-gateway.test.ts` covers the stub.
- `src/cli.ts` is not unit-tested; it is verified in the live run.
