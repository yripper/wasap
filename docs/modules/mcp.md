# MCP Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/mcp/` · **Last verified:** 2026-11-03

## Purpose

The MCP server Claude talks to: Streamable HTTP on `127.0.0.1` with bearer-token auth, the usage instructions sent on initialize, and 24 tools that are thin wrappers over `src/actions/`, the store and the voice domain. The daemon (`src/daemon/daemon.ts`) builds `ToolDeps` and passes a fresh `buildServer` per request to `startHttpServer`.

## Structure

| File | Purpose |
|---|---|
| `src/mcp/http.ts` | `node:http` server: Host check, bearer auth, stateless transport per request |
| `src/mcp/result.ts` | `ok` / `fail` / `run`: tool result envelope and `CODE: message` errors |
| `src/mcp/server.ts` | `ToolDeps`, `StatusReport`, `buildServer` (server name `wasap`) |
| `src/mcp/instructions.ts` | `BASE_INSTRUCTIONS`, `buildInstructions`, `readStyleGuide` |
| `src/mcp/format.ts` | `MessageView`, `ChatView`, `PendingView` and their formatters |
| `src/mcp/tools/annotations.ts` | `READ`, `LOCAL_WRITE`, `WHATSAPP_WRITE`, `DESTRUCTIVE` hints |
| `src/mcp/tools/schemas.ts` | shared `category` zod schema |
| `src/mcp/tools/{read,tracking,voice,messaging,organize,destructive}.ts` | tool registration by group |
| `src/testing/tool-deps.ts` | `makeToolDeps` / `connect`: in-memory deps and MCP client for tests |

## Public surface

- `startHttpServer(o: HttpOptions): Promise<RunningHttp>` (`http.ts:40`): bound to `127.0.0.1` only; `port: 0` picks a free port; `buildServer` is a factory supplied by the caller, called once per request.
- `tokenMatches(header, token)` (`http.ts:19`): constant-time compare of `Bearer <token>`; fails closed on an empty token.
- `hostAllowed(host, port)` (`http.ts:32`): only `127.0.0.1:<port>` or `localhost:<port>`.
- `ok(data)` (`result.ts:4`), `fail(e)` (`result.ts:10`), `run(fn)` (`result.ts:16`): errors come back as `isError: true` with `CODE: message` (plus `(retry after Ns)`).

- `buildServer(deps, instructions)` (`server.ts:30`); `ToolDeps { actions, db, voice, contacts, status }` (`server.ts:22`); `StatusReport { connection, lastEventAt, chats, messages, pending }` (`server.ts:14`).
- `buildInstructions(style)` (`instructions.ts:34`) appends `## Writing style\n\n<style>` to `BASE_INSTRUCTIONS` (`instructions.ts:5`); `readStyleGuide(path)` (`instructions.ts:40`) reads `~/.wasap/style.md`, null if missing or blank.

### Tools (24)

| Group | Tools | Annotations |
|---|---|---|
| read (`read.ts`) | `status`, `list_chats`, `get_pending` (returns `{ connection, items }`; `connection` is `gateway.state()` so Claude can warn that a non-open mirror may be stale), `read_history` (limit <= 100, `before_seq` = seq of the oldest message already seen; keyset on `(ts, seq)`, see store.md), `search_messages`, `get_chat_info` | `READ` |
| tracking (`tracking.ts`) | `snooze` (ISO with offset, future), `unsnooze`, `set_watch_level`, `set_category` | `LOCAL_WRITE` |
| voice (`voice.ts`) | `get_voice`, `get_my_messages` (exactly one of `chat_id` / `category`, limit <= 200), `list_stale_profiles` (`READ`); `save_profile` (body <= 4000), `save_chat_notes` (body <= 2000) (`LOCAL_WRITE`) | |
| messaging (`messaging.ts`) | `send_message` (also marks read), `mark_read` | `WHATSAPP_WRITE` |
| organize (`organize.ts`) | `archive_chats`, `unarchive_chats`, `mute_chat` (`until?` ISO; absent = forever), `unmute_chat` | `WHATSAPP_WRITE` |
| destructive (`destructive.ts`) | `leave_group`, `cleanup_apply` (`DESTRUCTIVE`); `cleanup_plan` (`LOCAL_WRITE`: stores a draft plan row) | |

All `chat_id` params are JID strings. `category` is lowercase, <= 32 chars, `/^[a-z0-9_-]+$/` (`schemas.ts:4`).

### Output format (`format.ts`)

- `MessageView { seq, ts (ISO), from: 'me' | { jid, name }, text, media, quoted_id, edited, deleted }` (`format.ts:6`). Media-only messages render `text` as `[<kind>]`, and `mediaKind 'other'` (types wasap can't render) as `[unsupported]`; deleted ones as `[deleted]`. In a DM with no stored sender, `from.jid` is the chat id.
- `ChatView.muted` is `'forever'` (stored `-1`), an ISO string for a future mute, or `null` (also for expired mutes); never a 1969 date (`format.ts:54`).
- `PendingView` = `ChatView` + `reason` + `latest_incoming`.

## Dependencies

- `@modelcontextprotocol/sdk`, `zod`, `src/domain/errors.ts`, `src/actions/*`, `src/domain/voice.ts`, `src/store/{pending-query,voice-repo,contacts-repo}.ts`.

## Gotchas & invariants

- Check order in `handle`: Host (403), path `/mcp` (404), bearer token (401), POST only (405).
- Stateless: a fresh server and transport per request so no state leaks between clients.
- Handler errors are logged via `describeError`, never tokens or bodies.

- **Read tools never touch the gateway and never mark anything read**; only `mark_read` and `send_message` do (tested in `server.test.ts`).
- `get_voice` returns own messages only, filtered in SQL (`MessagesRepo.outgoing(..., { textOnly: true })`: `from_me`, not deleted, non-empty text) so the limits count usable samples: `my_messages_in_chat` (<= 60) when `needsLearning` or `notesStale`, `my_messages_in_category` (<= 40, all chats in the category) when `needsLearning`.
- `cleanup_apply` takes the ids to leave (`chat_ids`), not exclusions; ids outside the plan land in `failed`.
- `BASE_INSTRUCTIONS` tells Claude to warn that data may be stale when `get_pending`'s `connection` is not `open`. It includes the base writing style (Chilean Spanish, no voseo, short, no sign-offs, no em dashes); the optional `style.md` is appended on top.
- Zod input errors come back as SDK "Input validation error", not `VALIDATION:`; action-level validation uses `AppError('VALIDATION')`.

## Testing

- `pnpm test src/mcp`: `http.test.ts` uses a real server on an ephemeral port; `server.test.ts` uses an in-memory MCP client over `makeToolDeps` (fake gateway, fake JIDs).
