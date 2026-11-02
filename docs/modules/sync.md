# Sync Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/sync/` · **Last verified:** 2026-11-03

## Purpose

Applies gateway `WaEvent`s to the store: chats, messages, contacts and LID/phone-number alias canonicalization. No I/O of its own besides the store repos.

## Structure

| File | Purpose |
|---|---|
| `src/sync/canonical.ts` | `chooseCanonical`: which chat id survives an alias pair |
| `src/sync/sink.ts` | `Sink`: `apply(event)` |

## Public surface

- `chooseCanonical(lid, pn, existing)` (`canonical.ts:7`): both chats exist, older `createdAt` wins (tie: `pn`); one exists, it wins; none, `pn`.
- `new Sink({ db, chats, messages, aliases, contacts, now })` (`sink.ts:24`): `apply(e)` (`sink.ts:38`), `lastEventAt()` (`sink.ts:30`), `connection()` (`sink.ts:34`).

## Key methods

- `Sink.apply` (`sink.ts:38`): `connection` events only update `connection()` (initial `'connecting'`) and don't touch `lastEventAt()`. Every other event runs in one `db.transaction`; a throw rolls back, propagates (the gateway guard logs it) and leaves `lastEventAt()` unchanged. `lastEventAt()` is `now()` after the last applied non-connection event.
- `Sink.linkAlias` (`sink.ts:72`): resolves both forms first, picks the winner with `chooseCanonical` on the resolved canonicals, `chats.mergeInto(loser, winner)` when both chats exist, `aliases.repoint(loser, winner)`, `messages.repointSender(loser, winner)` rewrites stored `sender_jid`, `contacts.copyIfMissing` carries names from the loser and both raw forms to the winner (never overwriting), then adds both raw forms pointing straight at the winner.
- `Sink.applyChat` (`sink.ts:101`): id resolved; upsert (null title/archived become `undefined` = keep; `ChatsRepo.upsert` also COALESCEs the title); `setWaMuted` only when `mutedUntil !== undefined`; `applyUnread` only when `unread` is non-null.
- `Sink.applyMessages` (`sink.ts:109`): senders paired via `senderAltJid` first (`linkSender`, `sink.ts:128`), then chat and sender ids resolved, placeholder chat upserted (`chatKind`), `insertMany` with `sentViaWasap: false`.
- `edit`/`revoke` resolve the chat id, then `editText`/`softDelete`.
- `contacts`: stored under the raw jid and, when it differs, the canonical one (senders are stored canonical).

## Dependencies

`src/store/*` repos, `chatKind` from `src/whatsapp/adapt.ts` (pulls in Baileys at runtime through that module), types from `src/whatsapp/types.ts`.

## Gotchas & invariants

- **Aliases stay flat:** every `jid_aliases.canonical` is a current canonical, never an alias key; `resolve()` is a single lookup and cannot loop. This holds because both sides are resolved before a pair is applied and `repoint` moves everything that pointed at the loser. Tests cover a second lid and a conflicting second phone number after a merge.
- A sender pair counts only when exactly one JID ends in `@lid` and the other in `@s.whatsapp.net`.
- `chats` events from groups after open carry `unread: null` and a title; a null title never wipes a stored one.
- Messages in this sink are never `sentViaWasap`; outbound sends are recorded by the send path, and the `INSERT OR IGNORE` on `(chat_id, wa_id)` keeps echoes from duplicating.
- Sender names join `contacts` by exact jid, so a name that arrived before the alias is copied to the winner on merge; stored `messages.sender_jid` is rewritten to the winner too (no person under two ids).
- Never log message content.

## Testing

`pnpm vitest run src/sync`: in-memory DB, `FakeGateway.emit` into `Sink.apply`, fake JIDs only.
