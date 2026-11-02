# WhatsApp Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/whatsapp/` · **Last verified:** 2026-11-03

## Purpose

The only place that imports `@whiskeysockets/baileys`. Converts Baileys objects into domain events, keeps the WhatsApp session encrypted at rest, and defines the gateway interface the rest of the daemon uses. Also owns the live Baileys socket (`BaileysGateway`), its bounded reconnect policy and the QR login flow.

## Structure

| File | Purpose |
|---|---|
| `src/whatsapp/types.ts` | `WaChat`, `WaMessage`, `WaEvent`, `ConnectionState`, `WhatsAppGateway` (no Baileys types leak) |
| `src/whatsapp/adapt.ts` | Baileys `WAMessage`/`Chat`/`Contact` to domain events |
| `src/whatsapp/auth-state.ts` | `useEncryptedAuthState`: AES-GCM file-per-key auth store |
| `src/whatsapp/session-crypto.ts` | `SessionCrypto` (AES-256-GCM) and `loadOrCreateAuthKey` (Keychain-backed key) |
| `src/whatsapp/backoff.ts` | Reconnect delay schedule |
| `src/whatsapp/connection.ts` | `ReconnectController`: bounded reconnect policy, Baileys-free |
| `src/whatsapp/events.ts` | Pure Baileys event payload to `WaEvent[]` mapping, `closeReason` |
| `src/whatsapp/gateway.ts` | `createSocket` (shared socket options) and `BaileysGateway` |
| `src/whatsapp/login.ts` | `runLogin`: QR pairing in the terminal |
| `src/testing/fake-gateway.ts` | `FakeGateway`: records calls, `emit(e)` pushes events |
| `src/testing/fixtures.ts` | `waMessage()` builder with fake JIDs |

## Public surface

- `WhatsAppGateway` (`types.ts:29`): `onEvent`, `sendText`, `markRead`, `setArchived`, `setMuted`, `leaveGroup`, `groupTitle`, `state`.
- `WaMessage` (`types.ts:16`) is `NewMessage` minus `sentViaWasap` plus `senderAltJid`; `chatId` is as Baileys gave it (may be `@lid`).
- `MessageKeyRef` is re-exported from `src/store/types.ts`.
- `BaileysGateway.start({ authDir, crypto, getMessageText, logger })` (`gateway.ts:84`) and `stop()` (`gateway.ts:92`).
- `runLogin({ authDir, crypto, print })` (`login.ts:22`) resolves `{ meJid }` (normalized, no device suffix).
- `ReconnectController` (`connection.ts:14`): `handleClose(reason)`, `handleOpen()`, `stop()`.

## Key methods

- `extractText` `adapt.ts:12`: priority `conversation`, `extendedTextMessage.text`, image/video/document caption, after `normalizeMessageContent` unwraps ephemeral/view-once/document-with-caption.
- `mediaKind` `adapt.ts:25`.
- `toWaEvents` `adapt.ts:64`: one `messages` event; `protocolMessage` REVOKE/MESSAGE_EDIT become `revoke`/`edit` keyed by `protocolMessage.key.id` with the outer `remoteJid`; reactions, other protocol messages, key-distribution-only, `status@broadcast`, newsletters and messages with no text and no media kind give `[]`.
- `toWaChat` `adapt.ts:104`: see unread gotcha.
- `toContactPairs` `adapt.ts:121`: names plus `lid`/`pn` alias pairs from Baileys contacts.
- `useEncryptedAuthState` `auth-state.ts:28`: files `0600` in a `0700` dir, names sanitized to `[A-Za-z0-9._-]`, write-then-rename; `clear()` deletes every file in the dir but not the dir.
- `loadOrCreateAuthKey` `session-crypto.ts:37`: reads `SECRET_ACCOUNTS.authKey` (64 hex), creates one if missing.
- `nextDelayMs` `backoff.ts:5`: 2s base, x2, 300s cap, +-20% jitter via injectable `random`, `null` from attempt 10.
- `skipChat` `adapt.ts:57`: `status@broadcast` and `@newsletter` are dropped everywhere.
- `ReconnectController.handleClose` `connection.ts:21`: `'logged_out'` emits `logged_out` and is terminal; `'other'` emits `reconnecting`, sleeps `delay(attempt)`, calls `connect`, and retries in-loop only if `connect` throws. `delay` returning `null` emits `gave_up` (terminal). A close arriving while a reconnect is in flight is ignored. `handleOpen` (`connection.ts:39`) resets the attempt counter; `stop` (`connection.ts:44`) makes it terminal, dropping a sleeping attempt.
- `createSocket` `gateway.ts:31`, socket options and why:
  - `auth` with `makeCacheableSignalKeyStore` over the encrypted store (avoids a disk read+decrypt per signal key).
  - `markOnlineOnConnect: false`: the phone keeps getting notifications and contacts don't see us online.
  - `syncFullHistory: true` + `browser: Browsers.macOS('Desktop')`: Baileys only sets the desktop `webSubPlatform` when both hold (`Utils/validate-connection.ts` `getWebInfo`), which makes the phone send full history instead of ~3 months. `syncFullHistory` is also sent as `requireFullSync` in the pairing payload, so login must use the same options (hence the shared builder).
  - `shouldSyncHistoryMessage: () => true`: process every history chunk type.
  - `getMessage`: returns `{ conversation: text }` from the store so retry receipts (peer asks us to re-encrypt a sent message) work; `undefined` when unknown.
  - `logger`: child at `warn` (or the parent's level if quieter); Baileys' debug/trace logs contain full message objects.
- Event mapping (`gateway.ts:192` via `events.ts`):
  - `messaging-history.set` → `mapHistorySet` (`events.ts:48`): `aliases` (from `lidPnMappings` when present, else chats' `lidJid`/`pnJid`, plus contacts' lid/pn; deduped), `contacts`, `chats` (history source), `messages`, then edit/revoke events. Aliases go first so ids can be resolved before storing.
  - `chats.upsert` → `chats` (history source); `chats.update` → `chats` (update source); `mapChats` `events.ts:29` skips entries without `id`.
  - `messages.upsert` (both `notify` and `append`) → `mapMessages` `events.ts:17`: one merged `messages` event plus separate `edit`/`revoke`.
  - `contacts.upsert`/`contacts.update` → `mapContacts` `events.ts:40`: `contacts` with `name ?? notify` only, plus any `aliases` the contacts carry.
  - `connection.update` `gateway.ts:207`: `open` → controller `handleOpen`, state `open`, then `groupFetchAllParticipating` once → `mapGroups` (`events.ts:61`, `unread: null`, `archived: null`, `mutedUntil: undefined`). `close` → `closeReason` (`events.ts:74`, Boom `output.statusCode`): `loggedOut` (401) emits `logged_out`, ends the socket, then `clear()`s the auth dir; anything else (including 515) goes to the controller.
  - `creds.update` → `saveCreds()`.
- `markRead` `gateway.ts:115`: always `chatModify({ markRead: true, lastMessages: [minimal] })`; `readMessages([key])` (blue ticks) only when `last.fromMe === false`. `minimal` (`gateway.ts:243`) is `{ key: { remoteJid, id, fromMe, participant? }, messageTimestamp }`, matching Baileys' `MinimalMessage = Pick<WAMessage, 'key' | 'messageTimestamp'>`; `participant` = `senderJid` for groups only.
- `setArchived` `gateway.ts:124`: `chatModify({ archive, lastMessages: [minimal] })`.
- `setMuted` `gateway.ts:130`: `chatModify({ mute: untilSec * 1000 | null })`. Units: Baileys copies `mute` verbatim into the absolute `muteAction.muteEndTimestamp` (`Utils/chat-utils.ts` `chatModificationToAppPatch`), i.e. epoch **milliseconds**. The Baileys README's "mute for 8 hours: `8*60*60*1000`" example is misleading (it is not a duration).
- `sendText` `gateway.ts:108`: returns `{ waId: sent.key.id, ts: toNumber(sent.messageTimestamp) }`. A quote needs `quoted.message` (Baileys builds `contextInfo.quotedMessage` from it and crashes without one), so `quotedMessage` (`gateway.ts:155`) fills `{ conversation: storedText ?? '' }`.
- `groupTitle` `gateway.ts:138`: `groupMetadata(chatId).subject`, `null` on error.
- `runLogin` `login.ts:22`: prints QR with `qrcode-terminal` `{ small: true }`; on `open` waits for pending creds writes, ends the socket and resolves; one `restartRequired` (515) after pairing reconnects immediately (protocol, not a failure), a second rejects. `loggedOut` clears stale creds and rejects `LOGGED_OUT`; other closes reject `AUTH_REQUIRED` (`login.ts:80`).

## Dependencies

Baileys (`makeWASocket`, `makeCacheableSignalKeyStore`, `Browsers`, `DisconnectReason`, `jidNormalizedUser`, `normalizeMessageContent`, `toNumber`, `proto`, `BufferJSON`, `initAuthCreds`), `pino` (login's silent logger), `qrcode-terminal`, `src/daemon/logger.ts`, `src/domain/errors.ts`, `src/secrets/keychain.ts`, `src/store/types.ts` (types only). The caller supplies `getMessageText` (the daemon wires `MessagesRepo.getText`).

## Gotchas & invariants

- **LID**: Baileys 7 may give `@lid` chat ids; `senderAltJid` carries `participantAlt` (groups) or `remoteJidAlt` (DMs) so the caller can resolve aliases. Adapters never resolve them.
- **Unread**: history sync gives an absolute count (`-1` means marked unread); `chats.update` gives increments, so `toWaChat` emits `absolute` for `'history'` and `live` for `'update'` (and `null` when the update has no `unreadCount` key). Do not mix them up.
- `mutedUntil`: `undefined` = no info, `null` = unmuted, number = unix seconds (Baileys `muteEndTime`).
- Timestamps are unix seconds via `toNumber` (Baileys may give `Long`).
- Edit/revoke `ts` is the outer message's timestamp, not the target's.
- A wrong auth key makes `useEncryptedAuthState` throw (GCM auth failure); never fall back to fresh creds on that error or the paired session is lost.
- Never log message text or names.
- **Gateway state**: methods throw `AppError('LOGGED_OUT')` when logged out and `AppError('INTERNAL', 'not connected (state: …)')` for any other non-`open` state (`gateway.ts:147`). `groupTitle` throws too when not open (only Baileys errors become `null`).
- `start` throws `AUTH_REQUIRED` when the creds have no `me` (never paired). It resolves once the socket is created, not when it opens; register `onEvent` right after `start` resolves (events are network-driven, so none fire before then).
- `logged_out` and `gave_up` are terminal for the process: nothing reconnects until the daemon restarts (after `wasap login` for the former). A 515 on the daemon's socket is handled by the normal backoff (first retry ~2s).
- On `loggedOut` the order is: emit `logged_out`, end socket, then `clear()`; clearing first lets a queued `creds.update` write recreate files.
- Events from a replaced socket are ignored (`sock !== this.sock` guard in `connect`, `gateway.ts:181`).
- The reconnect sleep timer is unref'd so a pending retry never keeps a stopping process alive.
- **Login and history**: the login socket ends right after `open`. History chunks it already processed in that window are dropped (no one listens); unprocessed ones are redelivered to the daemon's socket. Verify in the live run.
- `messaging-history.set` field names match the brief (`chats`, `contacts`, `messages`, `lidPnMappings?` — `Types/Events.d.ts:18`). Baileys' own `Utils/history` already merges chat `lidJid`/`pnJid` into `lidPnMappings`, so the chats fallback only matters when the field is absent.
- `mutedUntil` from Baileys `chats.update` comes from the same `muteEndTimestamp` (ms, `chat-utils.ts` `processSyncAction`); the "unix seconds" claim above is not verified for live updates.

## Testing

`adapt.test.ts`, `auth-state.test.ts`, `session-crypto.test.ts`, `backoff.test.ts`, `connection.test.ts` (reconnect policy with fake `connect`/`sleep`/`delay`), `events.test.ts` (event mapping with fake payloads and fake JIDs). Run `pnpm vitest run src/whatsapp`. `BaileysGateway` and `runLogin` are not unit-tested (they need a live socket); they are verified manually against a real account.
