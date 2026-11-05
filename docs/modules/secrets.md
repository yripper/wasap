# Secrets Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/secrets/` · **Last verified:** 2026-11-06

## Purpose

OS secret store access for the bearer token and the WhatsApp auth key: the macOS Keychain through the built-in `security` CLI, or a Linux Secret Service keyring (GNOME Keyring) through libsecret's `secret-tool`. Both are CLIs, so there is no native dependency. `createSecretStore` picks the backend by platform; the rest of the code only sees `SecretStore`.

## Structure

| File | Purpose |
|---|---|
| `src/secrets/keychain.ts` | `SecretStore` / `CommandRunner` interfaces, `SECRET_ACCOUNTS`, `SECRET_SERVICE`, `spawnRunner`, `assertSafe`, `securityCli` runner, `Keychain` store (macOS) |
| `src/secrets/secret-tool.ts` | `secretToolCli` runner, `SecretTool` store (Linux) |
| `src/secrets/store.ts` | `createSecretStore(platform)`: darwin → `Keychain`, linux → `SecretTool`, anything else throws |
| `src/secrets/keychain.test.ts` | Fake-runner tests, a real `spawnRunner` ENOENT check, opt-in real-Keychain round trip |
| `src/secrets/secret-tool.test.ts` | Fake-runner tests, a real spawn of a missing binary, opt-in real `secret-tool` round trip |
| `src/secrets/store.test.ts` | Platform selection |
| `src/testing/memory-secrets.ts` | `MemorySecretStore`: in-memory `SecretStore` for other modules' tests |

## Public surface

- `SecretStore` (`keychain.ts:4`): `get` (null when missing), `set`, `delete`.
- `CommandRunner` (`keychain.ts:10`): runs a CLI with args and optional stdin.
- `SECRET_ACCOUNTS` (`keychain.ts:14`): `bearerToken` = `bearer_token`, `authKey` = `auth_key`. `SECRET_SERVICE` (`keychain.ts:16`) = `wasap`.
- `spawnRunner(bin)` (`keychain.ts:26`): `CommandRunner` that spawns `bin` without a shell; a missing binary rejects with the spawn error (`code: 'ENOENT'`).
- `assertSafe(value)` (`keychain.ts:79`): shared value/account validation for both backends.
- `securityCli` (`keychain.ts:46`) = `spawnRunner('/usr/bin/security')`; `Keychain` (`keychain.ts:51`): `new Keychain(runner?, service?)`.
- `secretToolCli` (`secret-tool.ts:11`) = `spawnRunner('secret-tool')` (resolved through `PATH`); `SecretTool` (`secret-tool.ts:16`): `new SecretTool(runner?, service?)`.
- `createSecretStore(platform = process.platform)` (`store.ts:7`): what `src/cli.ts` uses for every command.

## Key methods

- `Keychain.get` (`keychain.ts:57`): exit 44 returns `null`, other non-zero throws `INTERNAL`.
- `Keychain.set` (`keychain.ts:64`): validates account and value, upserts via `security -i` with the command on stdin.
- `Keychain.delete` (`keychain.ts:71`): a missing item (44) counts as success.
- `SecretTool.get` (`secret-tool.ts:22`): `secret-tool lookup service <svc> account <acct>`. Exit 1 with empty stderr, or exit 0 with empty stdout, returns `null`; any other non-zero throws `INTERNAL` with the first stderr line (e.g. `Cannot autolaunch D-Bus without X11 $DISPLAY`). Strips one trailing newline.
- `SecretTool.set` (`secret-tool.ts:32`): validates, then `secret-tool store --label="<svc> <acct>" service <svc> account <acct>` with the value on stdin and no trailing newline (secret-tool stores every byte it reads from a non-TTY stdin). `store` replaces an existing item with the same attributes.
- `SecretTool.delete` (`secret-tool.ts:40`): `secret-tool clear ...`; exit 1 with empty stderr counts as success.
- `SecretTool.exec` (`secret-tool.ts:49`): turns `ENOENT` from the runner into `AppError('INTERNAL')` telling the user to `sudo apt install libsecret-tools`; other spawn errors are rethrown.
- `createSecretStore` (`store.ts:7`): any platform other than darwin/linux throws `INTERNAL` naming the platform.

## Dependencies

- `AppError` from `src/domain/errors.ts`; Node `child_process.spawn`.
- macOS: `/usr/bin/security` (built in). Linux: `secret-tool` from `libsecret-tools`, plus a running D-Bus session and an unlocked Secret Service keyring (GNOME Keyring).

## Gotchas & invariants

- Secrets travel on stdin (`security -i` on macOS, `secret-tool store` on Linux), never in argv.
- Values and accounts must match `[A-Za-z0-9+/=_.:-]` on both backends (`keychain.ts:22`), even though secret-tool doesn't need it, so a value that works on one OS works on the other. Binary keys must be base64/hex encoded by the caller.
- No plaintext fallback, ever: an unsupported platform, a missing `secret-tool` or an unreachable keyring all fail loudly.
- Error messages never include secret values. `SecretTool` includes secret-tool's stderr (first line, max 200 chars): it can't contain the value, which only goes on stdin, and it's the only place that explains a locked keyring or missing D-Bus.
- `secret-tool` uses exit 1 both for "not found" and for real errors; the empty-stderr check is what tells them apart.
- `spawnOnce` (`keychain.ts:30`) swallows `child.stdin` errors (EPIPE) because the `close`/`error` handlers already report failure.

## Testing

- `pnpm test src/secrets`: fake runners, never touches a real Keychain or keyring. The only real spawns are of nonexistent binaries (ENOENT paths).
- `WASAP_KEYCHAIN_IT=1 pnpm test src/secrets` (macOS) runs a real round trip under the throwaway service `wasap-test`.
- `WASAP_SECRET_TOOL_IT=1 pnpm test src/secrets` (Linux, keyring unlocked) does the same through `secret-tool`. Verified 2026-11-06 on Ubuntu 24.04 in a container with `dbus-run-session` and `gnome-keyring-daemon --unlock --components=secrets`.
- Other modules use `MemorySecretStore` (`src/testing/memory-secrets.ts:3`).
