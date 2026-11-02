# WhatsApp Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/whatsapp/` · **Last verified:** 2026-11-03

## Purpose

The only place that imports `@whiskeysockets/baileys`. Converts Baileys objects into domain events, keeps the WhatsApp session encrypted at rest, and defines the gateway interface the rest of the daemon uses. This doc covers the pure parts; the live socket is added later and must be listed here when it lands.

## Structure

| File | Purpose |
|---|---|
| `src/whatsapp/types.ts` | `WaChat`, `WaMessage`, `WaEvent`, `ConnectionState`, `WhatsAppGateway` (no Baileys types leak) |
| `src/whatsapp/adapt.ts` | Baileys `WAMessage`/`Chat`/`Contact` to domain events |
| `src/whatsapp/auth-state.ts` | `useEncryptedAuthState`: AES-GCM file-per-key auth store |
| `src/whatsapp/session-crypto.ts` | `SessionCrypto` (AES-256-GCM) and `loadOrCreateAuthKey` (Keychain-backed key) |
| `src/whatsapp/backoff.ts` | Reconnect delay schedule |
| `src/testing/fake-gateway.ts` | `FakeGateway`: records calls, `emit(e)` pushes events |
| `src/testing/fixtures.ts` | `waMessage()` builder with fake JIDs |

## Public surface

- `WhatsAppGateway` (`types.ts:29`): `onEvent`, `sendText`, `markRead`, `setArchived`, `setMuted`, `leaveGroup`, `groupTitle`, `state`.
- `WaMessage` (`types.ts:16`) is `NewMessage` minus `sentViaWasap` plus `senderAltJid`; `chatId` is as Baileys gave it (may be `@lid`).
- `MessageKeyRef` is re-exported from `src/store/types.ts`.

## Key methods

- `extractText` `adapt.ts:12`: priority `conversation`, `extendedTextMessage.text`, image/video/document caption, after `normalizeMessageContent` unwraps ephemeral/view-once/document-with-caption.
- `mediaKind` `adapt.ts:25`.
- `toWaEvents` `adapt.ts:63`: one `messages` event; `protocolMessage` REVOKE/MESSAGE_EDIT become `revoke`/`edit` keyed by `protocolMessage.key.id` with the outer `remoteJid`; reactions, other protocol messages, key-distribution-only, `status@broadcast`, newsletters and messages with no text and no media kind give `[]`.
- `toWaChat` `adapt.ts:103`: see unread gotcha.
- `toContactPairs` `adapt.ts:120`: names plus `lid`/`pn` alias pairs from Baileys contacts.
- `useEncryptedAuthState` `auth-state.ts:28`: files `0600` in a `0700` dir, names sanitized to `[A-Za-z0-9._-]`, write-then-rename; `clear()` deletes every file in the dir but not the dir.
- `loadOrCreateAuthKey` `session-crypto.ts:37`: reads `SECRET_ACCOUNTS.authKey` (64 hex), creates one if missing.
- `nextDelayMs` `backoff.ts:5`: 2s base, x2, 300s cap, +-20% jitter via injectable `random`, `null` from attempt 10.

## Dependencies

Baileys (`normalizeMessageContent`, `toNumber`, `proto`, `BufferJSON`, `initAuthCreds`), `src/secrets/keychain.ts`, `src/store/types.ts` (types only).

## Gotchas & invariants

- **LID**: Baileys 7 may give `@lid` chat ids; `senderAltJid` carries `participantAlt` (groups) or `remoteJidAlt` (DMs) so the caller can resolve aliases. Adapters never resolve them.
- **Unread**: history sync gives an absolute count (`-1` means marked unread); `chats.update` gives increments, so `toWaChat` emits `absolute` for `'history'` and `live` for `'update'` (and `null` when the update has no `unreadCount` key). Do not mix them up.
- `mutedUntil`: `undefined` = no info, `null` = unmuted, number = unix seconds (Baileys `muteEndTime`).
- Timestamps are unix seconds via `toNumber` (Baileys may give `Long`).
- Edit/revoke `ts` is the outer message's timestamp, not the target's.
- A wrong auth key makes `useEncryptedAuthState` throw (GCM auth failure); never fall back to fresh creds on that error or the paired session is lost.
- Never log message text or names.

## Testing

`adapt.test.ts`, `auth-state.test.ts`, `session-crypto.test.ts`, `backoff.test.ts` (fake JIDs only). Run `pnpm vitest run src/whatsapp`.
