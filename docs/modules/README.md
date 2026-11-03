# Module Documentation Index

Living docs, one per module. **Read the relevant doc before modifying a module; update it in the same change.** See the "Module Documentation Convention" section in `CLAUDE.md` for the workflow.

| Doc | Module | One-liner |
|---|---|---|
| [domain.md](domain.md) | `src/domain/` | Pure logic with no I/O: `AppError` and rate limiting. |
| [mcp.md](mcp.md) | `src/mcp/` | The MCP server Claude talks to: HTTP transport with bearer auth, usage instructions, formatting and the 24 tools. |
| [secrets.md](secrets.md) | `src/secrets/` | macOS Keychain access through the built-in `security` CLI. |
| [config.md](config.md) | `src/config/` | `~/.wasap` path layout and zod-validated config. |
| [daemon.md](daemon.md) | `src/daemon/`, `src/cli.ts`, `ecosystem.config.cjs` | Daemon wiring (`startDaemon`), lock, logger, bearer token, connection snippets, the `wasap` CLI and the pm2 config. |
| [store.md](store.md) | `src/store/` | SQLite schema and repos: chats, messages (FTS), JID aliases, contacts, audit, cleanup plans. |
| [whatsapp.md](whatsapp.md) | `src/whatsapp/` | Baileys boundary: event adapters, encrypted auth state, live gateway with backoff reconnect, QR login and logout. |
| [sync.md](sync.md) | `src/sync/` | Applies gateway events to the store with LID/phone alias canonicalization. |
| [voice.md](voice.md) | `src/store/voice-repo.ts`, `src/domain/voice.ts` | Tone profiles per category, per-chat notes, and staleness rules. |
| [actions.md](actions.md) | `src/actions/` | Send, mark read, archive, mute, leave groups and two-step group cleanup, rate limited and audited. |
