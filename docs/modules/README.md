# Module Documentation Index

Living docs, one per module. **Read the relevant doc before modifying a module; update it in the same change.** See the "Module Documentation Convention" section in `CLAUDE.md` for the workflow.

| Doc | Module | One-liner |
|---|---|---|
| [domain.md](domain.md) | `src/domain/` | Pure logic with no I/O: `AppError` and rate limiting. |
| [mcp.md](mcp.md) | `src/mcp/` | The MCP server Claude talks to: Streamable HTTP on `127.0.0.1`, bearer-token auth and result helpers. |
| [secrets.md](secrets.md) | `src/secrets/` | macOS Keychain access through the built-in `security` CLI. |
| [config.md](config.md) | `src/config/` | `~/.wasap` path layout and zod-validated config. |
| [daemon.md](daemon.md) | `src/daemon/` | Single-instance lock, logger, background loop, bearer token and connection snippets. |
| [store.md](store.md) | `src/store/` | SQLite schema and repos: chats, messages (FTS), JID aliases, contacts, audit, cleanup plans. |
| [whatsapp.md](whatsapp.md) | `src/whatsapp/` | Baileys boundary: event adapters, encrypted auth state, live gateway with bounded reconnect, QR login. |
