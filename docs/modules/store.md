# Store Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/store/` · **Last verified:** 2026-11-03

## Purpose

SQLite mirror of the WhatsApp account (better-sqlite3, WAL): chats, messages with FTS5 search, JID aliases, contact names, audit log and cleanup plans. Pure persistence; no Baileys imports.

## Structure

| File | Purpose |
|---|---|
| `src/store/db.ts` | `openDb`, `migrate` (user_version-driven) |
| `src/store/schema.ts` | `MIGRATIONS` (append-only), FTS triggers |
| `src/store/types.ts` | `ChatRow`, `ChatUpsert`, `UnreadSignal`, `NewMessage`, `MessageRow`, `MessageKeyRef` |
| `src/store/chats-repo.ts` | `ChatsRepo` |
| `src/store/messages-repo.ts` | `MessagesRepo` |
| `src/store/aliases-repo.ts` | `AliasesRepo` (`@lid` / phone JID → canonical) |
| `src/store/contacts-repo.ts` | `ContactsRepo` (jid → saved name) |
| `src/store/audit-repo.ts` | `AuditRepo` (metadata only) |
| `src/store/cleanup-plans-repo.ts` | `CleanupPlansRepo` (draft → applied) |

## Public surface

- `openDb(file)` (`db.ts:6`), `migrate(db)` (`db.ts:14`).
- `new ChatsRepo(db, defaultWatch: (kind) => WatchLevel)` (`chats-repo.ts:34`): `upsert`, `applyUnread`, `get`, `list`, `setWatchLevel`, `setCategory`, `setSnooze`, `setArchived`, `setWaMuted`, `touchLastMessage`, `mergeInto`.
- `new MessagesRepo(db)` (`messages-repo.ts:39`): `insertMany`, `editText`, `softDelete`, `history`, `search`, `latestKey`, `outgoing`, `countOutgoingSince`, `getText`.
- `new AliasesRepo(db)`, `new ContactsRepo(db)`, `new AuditRepo(db)`, `new CleanupPlansRepo(db)`.

## Key methods

- `ChatsRepo.upsert` (`chats-repo.ts:42`): insert sets `watch_level` from `defaultWatch(kind)`; the conflict branch never touches `watch_level`, `category`, `snooze_until`. `title`/`archived`/`waMutedUntil` only change when supplied (`undefined` = keep; `waMutedUntil: null` clears).
- `ChatsRepo.applyUnread` (`chats-repo.ts:70`): see unread invariant.
- `ChatsRepo.mergeInto` (`chats-repo.ts:148`): see merge invariant.
- `MessagesRepo.insertMany` (`messages-repo.ts:44`): `INSERT OR IGNORE`, one transaction, moves `chats.last_msg_*` forward with SQL (no ChatsRepo dependency).
- `MessagesRepo.softDelete` (`messages-repo.ts:72`): sets `deleted_at`, nulls `text` (FTS trigger drops it from the index).
- `MessagesRepo.search` (`messages-repo.ts:84`): tokens are quoted (`toFtsQuery`, `messages-repo.ts:32`) so FTS syntax in the query is literal.
- `AliasesRepo.repoint` (`aliases-repo.ts:18`): moves aliases of the old canonical and also records old canonical → new.

## Dependencies

- `better-sqlite3`; `WatchLevel` from `src/config/config.ts`.

## Gotchas & invariants

- **Unread storage:** `unread_count` is never negative. `markedUnread` is its own column. `live` signals (chats.update): `-1` sets marked and leaves the count; positive values are increments added to `max(count, 0)` and leave marked alone; `0` zeroes the count and clears marked; `null` is a no-op. `absolute` signals (history sync, chats.upsert): count = `max(count, 0)`, marked = given flag OR `count < 0`.
- **Merge rule (`mergeInto(from, into)`):** messages move with `UPDATE OR IGNORE` on `(chat_id, wa_id)`, leftovers (duplicates) are deleted. The surviving row is `into`, but `watch_level`, `category`, `snooze_until` come from whichever row has the older `created_at` (tie: `into`), and `created_at` becomes the older one. Unread is summed, `marked_unread` ORed, `last_msg_*` taken from the newer row. If `into` does not exist, `from` is renamed. FTS stays consistent because only `chat_id` changes on moved rows and deleted duplicates fire the delete trigger.
- `last_msg_ts` is forward-only (`ts >= current`), so backfill can't regress it.
- `latestKey` orders by `ts`, `history` by `seq` (backfilled rows get later seqs).
- `messages.text` is nullable (media, deleted). Never log it.
- Migrations are append-only; never edit migration 0.
- `CleanupCriteria` is a loose `Record<string, unknown>`: the cleanup domain module (later task) should tighten it.

## Testing

- `pnpm vitest run src/store`: in-memory databases (`openDb(':memory:')`), fake JIDs only (`111@s.whatsapp.net`, `222@lid`, `999-1@g.us`).
