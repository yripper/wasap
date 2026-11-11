# Actions Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/actions/` · **Last verified:** 2026-11-11

## Purpose

Everything that changes WhatsApp or the user's local organization: send, mark read, archive, mute, leave groups and the two-step group cleanup. MCP tools (later task) are thin wrappers over these functions. Each side effect is rate limited where it matters and audited with metadata only.

## Structure

| File | Purpose |
|---|---|
| `src/actions/context.ts` | `ActionDeps` (carries `aliases` so a phone number finds a chat stored under its @lid), `acquire`, `audited`, `requireChat` |
| `src/actions/messaging.ts` | `sendMessage`, `markRead` |
| `src/actions/recipient.ts` | `normalizeRecipient`, `planRecipient`, `confirmOnWhatsApp`: who a send goes to, including a phone number with no chat yet |
| `src/actions/organize.ts` | `archiveChats`, `unarchiveChats`, `muteChat`, `unmuteChat` |
| `src/actions/destructive.ts` | `leaveGroup` |
| `src/actions/cleanup.ts` | `cleanupPlan`, `cleanupApply` |
| `src/testing/action-deps.ts` | `makeActionDeps`: in-memory store, `FakeGateway`, fake clock and recorded sleeps |

## Public surface

- `sendMessage(d, to, text, replyToWaId?)` (`messaging.ts:17`) returns `{ chatId, waId, markedRead }`. `to` is a chat id or a phone number with country code; `chatId` is the store id to use with the other tools.
- `normalizeRecipient(input)` (`recipient.ts:20`): a string with `@` passes through; otherwise separators (spaces, `-`, `(`, `)`, `.`) are dropped and an optional leading `+` and 7 to 15 digits become `<digits>@s.whatsapp.net`; anything else is `VALIDATION`.
- `markRead(d, chatId)` (`messaging.ts:61`) returns `true` when marked, `false` (no WhatsApp call) for a chat without stored messages; the `mark_read` tool turns that into `{ marked: false, reason: 'no messages stored' }`.
- `archiveChats` / `unarchiveChats` (`organize.ts:24`, `:25`), `muteChat(d, chatId, untilSec | null)` (`organize.ts:28`), `unmuteChat` (`organize.ts:35`).
- `leaveGroup(d, chatId)` (`destructive.ts:4`).
- `cleanupPlan(d, { inactiveDays, excludeFull: true })` (`cleanup.ts:14`) returns a stored draft `CleanupPlan`; `cleanupApply(d, planId, chatIds)` (`cleanup.ts:43`) returns `{ left, failed }`.

## Key methods

- `sendMessage`: `planRecipient` (`recipient.ts:31`), quoted key from the store (`MessagesRepo.keyOf`, `NOT_FOUND` if absent), `chatGap` then `sends` limiter, for a new number `confirmOnWhatsApp` (`recipient.ts:40`, `NOT_FOUND` "… is not on WhatsApp" when the gateway returns null), captures `latestKey` before inserting the outgoing row, `gateway.sendText`, for a new number `chats.upsert({ kind: 'dm', firstSeenAs })`, insert (`sentViaWasap: true`, `fromMe`, `senderJid: null`), then `markRead` on the captured key and `applyUnread(live, 0)`.
- `planRecipient` (`recipient.ts:31`): normalizes, resolves through `aliases`, and returns the stored chat when there is one (`isNew: false`, unchanged behavior). An unknown `@s.whatsapp.net` JID becomes `isNew: true`; an unknown group or `@lid` is `NOT_FOUND` as before, since only phone numbers can be checked with WhatsApp.
- `audited` (`context.ts:34`): records action, chat id and `ok`/`error`. Nothing else goes into the audit row.
- `cleanupApply` (`cleanup.ts:43`): validates plan (exists, unexpired, draft), splits ids into in-plan and not, flips the plan with `markApplied` (compare-and-set) before any call, then leaves each group via `leaveGroup`, sleeping `CLEANUP_CALL_GAP_MS` between calls.

## Dependencies

`WhatsAppGateway` (`onWhatsApp` added for new numbers), `AliasesRepo`, `Sink` (carried in deps for later tasks, not used by these actions), `ChatsRepo`, `MessagesRepo` (`keyOf`, `lastOutgoingTs` added here), `AuditRepo`, `CleanupPlansRepo`, `RateLimiter`/`PerKeyGap`, `AppError`.

## Gotchas & invariants

- **Send succeeds even if follow-ups fail.** A store failure after `sendText` is audited as `send_message.store` and swallowed (a throw would invite a duplicate send). A `markRead` failure returns `markedRead: false`. No prior message in the chat also gives `markedRead: false`.
- Mute convention: `null` from the caller means forever, passed to the gateway and stored as `-1`; otherwise seconds. `unmuteChat` passes `null` and stores `null`.
- Archive needs an anchor message: every chat in the batch is resolved first, and a chat with no messages rejects the whole batch with `VALIDATION` before any call. After that, chats are processed in order; a gateway failure leaves earlier ones archived.
- **WhatsApp is addressed by `chat.waJid`, never the canonical id.** Baileys copies the JID verbatim into app-state patch indexes and keys (no lid/pn translation), so `sendText`, `markRead`, `setArchived`, `setMuted` and `leaveGroup` all get `ChatRow.waJid`; the store and audit keep the canonical id. Message keys carry the raw sender (`MessageKeyRef.senderJid` comes from `sender_wa_jid`). Tests: `src/actions/wa-jid.test.ts`.
- **Sending to a new number.** The rate limits (`chatGap` keyed by the phone JID, then `sends`) are taken before the `onWhatsApp` lookup, so checking numbers is paced like sending, and a number that turns out not to be on WhatsApp still spends a send slot. The new chat row is upserted with `firstSeenAs`, never `waJid`, so if the live echo of our own message created the chat first (possibly under a different JID), its `wa_jid` wins. The row starts on the default `dm` watch level and `general` category; `markedRead` is `false` (nothing to anchor on). `reply_to` on a new number fails with `NOT_FOUND` before any WhatsApp call. Tests: `src/actions/recipient.test.ts`.
- Invalid input uses `VALIDATION` (the existing `ErrorCode`; there is no `INVALID_INPUT`).
- `leaveGroup` mutes watch locally; history stays searchable. DMs are rejected.
- Cleanup only plans groups on `normal` watch (`cleanup.ts:14`): never `full` (re-checked before leaving), and never `muted`, because `leaveGroup` sets `muted` and a left group stays in WhatsApp's chat list, so it would otherwise reappear in every later plan. Side effect: a group the user muted by hand is also never proposed. Ids not in the plan are reported in `failed`, never acted on. A plan is single use: a second apply fails with `VALIDATION` even if the first partly failed.
- In cleanup, a `RATE_LIMITED` from the destructive limiter sleeps `retryAfterSec` once and retries; if it fails again the chat goes to `failed`.
- Audit rows never contain text or titles. Never log message text.

## Testing

`src/actions/*.test.ts`, all on `makeActionDeps` (`FakeGateway.failOn` injects failures; `clock` and `sleeps` make pacing deterministic). Audit tests assert no message text lands in audit rows.
