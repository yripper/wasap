# Secrets Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/secrets/` · **Last verified:** 2026-11-03

## Purpose

macOS Keychain access through the built-in `security` CLI: the bearer token and the WhatsApp auth key.

## Structure

| File | Purpose |
|---|---|
| `src/secrets/keychain.ts` | `SecretStore` / `CommandRunner` interfaces, `securityCli` runner, `Keychain` store, `SECRET_ACCOUNTS` |
| `src/secrets/keychain.test.ts` | Unit tests with a fake runner, plus an opt-in real-Keychain round trip |
| `src/testing/memory-secrets.ts` | `MemorySecretStore`: in-memory `SecretStore` for other modules' tests |

## Public surface

- `SecretStore` (`keychain.ts:4`): `get` (null when missing), `set`, `delete`.
- `CommandRunner` (`keychain.ts:10`): runs `/usr/bin/security` with args and optional stdin.
- `securityCli` (`keychain.ts:23`): the real runner.
- `Keychain` (`keychain.ts:44`): `new Keychain(runner?, service?)`, service defaults to `wasap`.
- `SECRET_ACCOUNTS` (`keychain.ts:14`): `bearerToken` = `bearer_token`, `authKey` = `auth_key`.

## Key methods

- `Keychain.get` (`keychain.ts:50`): exit 44 returns `null`, other non-zero throws `INTERNAL`.
- `Keychain.set` (`keychain.ts:57`): validates account and value, upserts via `security -i` with the command on stdin.
- `Keychain.delete` (`keychain.ts:64`): a missing item (44) counts as success.
- `assertSafe` (`keychain.ts:72`): rejects anything outside `SAFE_VALUE` (`keychain.ts:21`) with `VALIDATION`.

## Dependencies

- `AppError` from `src/domain/errors.ts`; Node `child_process.spawn`; `/usr/bin/security` (macOS only).

## Gotchas & invariants

- Secrets travel on stdin (`security -i`), never in argv.
- Values must match `[A-Za-z0-9+/=_.:-]`; binary keys must be base64/hex encoded by the caller.
- Error messages never include secret values.
- `securityCli` swallows `child.stdin` errors (EPIPE) because the `close`/`error` handlers already report failure.

## Testing

- `pnpm test src/secrets`: fake runner, never touches the real Keychain.
- `WASAP_KEYCHAIN_IT=1 pnpm test src/secrets` also runs a real round trip under the throwaway service `wasap-test`.
- Other modules use `MemorySecretStore` (`src/testing/memory-secrets.ts:3`).
