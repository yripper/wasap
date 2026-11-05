# Config Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/config/` · **Last verified:** 2026-11-06

## Purpose

`~/.wasap` path layout and zod-validated config.

## Structure

| File | Purpose |
|---|---|
| `src/config/paths.ts` | `AppPaths`, `resolvePaths`, `ensureHome` |
| `src/config/config.ts` | `configSchema`, `Config`, `WatchLevel`, `loadConfig`, `saveConfig` |

## Public surface

- `AppPaths` (`paths.ts:5`): `home`, `config`, `db`, `authDir`, `lock`, `style`.
- `resolvePaths(env)` (`paths.ts:16`): `WASAP_HOME` or `~/.wasap`; files `config.json`, `wasap.db`, `auth/`, `wasap.lock`, `style.md`.
- `ensureHome(paths)` (`paths.ts:30`): creates `home` and `authDir`, both chmod 0700.
- `Config` / `configSchema` (`config.ts:9`): `port` (default 7778, 1024-65535), `sendsPerMinute` (20), `destructivePerMinute` (30), `perChatSendGapMs` (1000), `watchDefaults.group` (`'normal'`).
- `WatchLevel` (`config.ts:7`): `'full' | 'normal' | 'muted'`.
- `loadConfig(path)` (`config.ts:20`): defaults when the file is missing; `VALIDATION` on bad JSON or out-of-range values.
- `saveConfig(path, config)` (`config.ts:36`): writes with mode 0600.

## Dependencies

- `AppError` from `src/domain/errors.ts`; `zod`.

## Gotchas & invariants

- `mkdir`'s `mode` is ignored for existing directories, hence the explicit `chmod`.
- zod 4's `.default()` does not re-parse inner defaults, so `watchDefaults` has a full literal default.
- Secrets never live in config; they go to the OS secret store (`src/secrets/`).
- `~/.wasap` comes from `os.homedir()` and the 0700/0600 modes are plain POSIX `chmod`, so paths and permissions behave the same on Linux (paths/config tests pass on Ubuntu 24.04, 2026-11-06).

## Testing

- `pnpm test src/config`: temp dirs only.
