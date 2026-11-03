# Actions Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/actions/` · **Last verified:** 2026-11-03

## Purpose

Everything that changes WhatsApp or the user's local organization: send, mark read, archive, mute, leave groups and the two-step group cleanup. MCP tools (later task) are thin wrappers over these functions. Each side effect is rate limited where it matters and audited with metadata only.

## Structure

| File | Purpose |
|---|---|
| `src/actions/context.ts` | `ActionDeps`, `acquire`, `audited`, `requireChat` |
| `src/actions/messaging.ts` | `sendMessage`, `markRead` |
| `src/actions/organize.ts` | `archiveChats`, `unarchiveChats`, `muteChat`, `unmuteChat` |
| `src/actions/destructive.ts` | `leaveGroup` |
| `src/actions/cleanup.ts` | `cleanupPlan`, `cleanupApply` |
| `src/testing/action-deps.ts` | `makeActionDeps`: in-memory store, `FakeGateway`, fake clock and recorded sleeps |

## Public surface

- `sendMessage(d, chatId, text, replyToWaId?)` (`messaging.ts:13`) returns `{ waId, markedRead }`.
- `markRead(d, chatId)` (`messaging.ts:52`) returns `true` when marked, `false` (no WhatsApp call) for a chat without stored messages; the `mark_read` tool turns that into `{ marked: false, reason: 'no messages stored' }`.
- `archiveChats` / `unarchiveChats` (`organize.ts:24`, `:25`), `muteChat(d, chatId, untilSec | null)` (`organize.ts:28`), `unmuteChat` (`organize.ts:35`).
- `leaveGroup(d, chatId)` (`destructive.ts:4`).
- `cleanupPlan(d, { inactiveDays, excludeFull: true })` (`cleanup.ts:14`) returns a stored draft `CleanupPlan`; `cleanupApply(d, planId, chatIds)` (`cleanup.ts:43`) returns `{ left, failed }`.

## Key methods

- `sendMessage`: `requireChat`, quoted key from the store (`MessagesRepo.keyOf`, `NOT_FOUND` if absent), `chatGap` then `sends` limiter, captures `latestKey` before inserting the outgoing row, `gateway.sendText`, insert (`sentViaWasap: true`, `fromMe`, `senderJid: null`), then `markRead` on the captured key and `applyUnread(live, 0)`.
- `audited` (`context.ts:31`): records action, chat id and `ok`/`error`. Nothing else goes into the audit row.
- `cleanupApply` (`cleanup.ts:43`): validates plan (exists, unexpired, draft), splits ids into in-plan and not, flips the plan with `markApplied` (compare-and-set) before any call, then leaves each group via `leaveGroup`, sleeping `CLEANUP_CALL_GAP_MS` between calls.

## Dependencies

`WhatsAppGateway`, `Sink` (carried in deps for later tasks, not used by these actions), `ChatsRepo`, `MessagesRepo` (`keyOf`, `lastOutgoingTs` added here), `AuditRepo`, `CleanupPlansRepo`, `RateLimiter`/`PerKeyGap`, `AppError`.

## Gotchas & invariants

- **Send succeeds even if follow-ups fail.** A store failure after `sendText` is audited as `send_message.store` and swallowed (a throw would invite a duplicate send). A `markRead` failure returns `markedRead: false`. No prior message in the chat also gives `markedRead: false`.
- Mute convention: `null` from the caller means forever, passed to the gateway and stored as `-1`; otherwise seconds. `unmuteChat` passes `null` and stores `null`.
- Archive needs an anchor message: every chat in the batch is resolved first, and a chat with no messages rejects the whole batch with `VALIDATION` before any call. After that, chats are processed in order; a gateway failure leaves earlier ones archived.
- **WhatsApp is addressed by `chat.waJid`, never the canonical id.** Baileys copies the JID verbatim into app-state patch indexes and keys (no lid/pn translation), so `sendText`, `markRead`, `setArchived`, `setMuted` and `leaveGroup` all get `ChatRow.waJid`; the store and audit keep the canonical id. Message keys carry the raw sender (`MessageKeyRef.senderJid` comes from `sender_wa_jid`). Tests: `src/actions/wa-jid.test.ts`.
- Invalid input uses `VALIDATION` (the existing `ErrorCode`; there is no `INVALID_INPUT`).
- `leaveGroup` mutes watch locally; history stays searchable. DMs are rejected.
- Cleanup only plans groups on `normal` watch (`cleanup.ts:14`): never `full` (re-checked before leaving), and never `muted`, because `leaveGroup` sets `muted` and a left group stays in WhatsApp's chat list, so it would otherwise reappear in every later plan. Side effect: a group the user muted by hand is also never proposed. Ids not in the plan are reported in `failed`, never acted on. A plan is single use: a second apply fails with `VALIDATION` even if the first partly failed.
- In cleanup, a `RATE_LIMITED` from the destructive limiter sleeps `retryAfterSec` once and retries; if it fails again the chat goes to `failed`.
- Audit rows never contain text or titles. Never log message text.

## Testing

`src/actions/*.test.ts`, all on `makeActionDeps` (`FakeGateway.failOn` injects failures; `clock` and `sleeps` make pacing deterministic). Audit tests assert no message text lands in audit rows.
