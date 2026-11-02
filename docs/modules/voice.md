# Voice Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/store/voice-repo.ts`, `src/domain/voice.ts` · **Last verified:** 2026-11-03

## Purpose

Storage and staleness logic for writing in the user's voice: one tone profile per chat category and free-form notes per chat. The daemon never writes profile text itself (no LLM calls); Claude learns a profile and saves it, and this module says when a saved profile or note is due for a refresh.

## Structure

| File | Purpose |
|---|---|
| `src/store/voice-repo.ts` | `VoiceRepo`: profiles, notes, category outgoing count |
| `src/domain/voice.ts` | `STALE`, `isStale`, `voiceContext`, `staleProfiles` |
| `src/store/schema.ts` | Migration 1 adds `tone_profiles` and `chat_notes` (`schema.ts:85`, `schema.ts:91`) |

## Public surface

- `VoiceRepo` (`voice-repo.ts`): `getProfile` (`:12`), `saveProfile` (`:19`), `listProfiles` (`:28`, metadata only), `getNotes` (`:36`), `saveNotes` (`:43`), `countOutgoingInCategory` (`:53`).
- `STALE = { sentMessages: 30, ageSec: 21 * 86400 }` (`voice.ts:7`).
- `isStale(updatedAt, sentSince, nowSec)` (`voice.ts:24`): true if `sentSince >= 30` or `nowSec - updatedAt >= 21 days`.
- `voiceContext(deps, chatId, nowSec): VoiceContext` (`voice.ts:32`); `staleProfiles(deps, nowSec): string[]` (`voice.ts:53`).

## Key methods

- `voiceContext`: loads the chat's category, that category's profile and the chat's notes. Profile `sentSince` = outgoing messages since the profile's `updated_at` across all chats whose current category matches (`countOutgoingInCategory`, one SQL join, uncapped). Notes `sentSince` = `MessagesRepo.countOutgoingSince([chatId], updatedAt)`. `needsLearning` = no profile or `profileStale`. Staleness counts include messages sent through wasap (they still mean the user has been writing), but the samples Claude learns from (`outgoing` with `textOnly`) exclude them.
- Saving is an upsert keyed by category / chat id; `updated_at` resets the staleness window.

## Dependencies

- `ChatsRepo.get`, `MessagesRepo.countOutgoingSince`, `AppError` (`src/domain/errors.ts`).

## Gotchas & invariants

- **Profiles and notes are personal data.** They live only in the SQLite DB under `~/.wasap/`; never log, commit or put them in fixtures. `listProfiles` returns no bodies on purpose.
- Unknown chat id -> `AppError('NOT_FOUND')`.
- `notesStale` is false with no notes; `profileStale` is false with no profile (`needsLearning` covers that case).
- Category membership is the chat's *current* category, so recategorizing a chat moves its past messages into the new category's count.
- Soft-deleted (revoked) outgoing messages still count: the user wrote them and the goal is measuring activity (tested in `voice-repo.test.ts`).
- The window is inclusive: a message with `ts === updated_at` counts (`m.ts >= ?`, `voice-repo.ts:56`).
- The count includes messages sent via wasap and from the phone alike (`from_me = 1`).

## Testing

- `pnpm vitest run src/store/voice-repo.test.ts src/domain/voice.test.ts`: in-memory DBs, fake JIDs only.
