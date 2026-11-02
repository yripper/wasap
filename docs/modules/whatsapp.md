# WhatsApp Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/whatsapp/` · **Last verified:** 2026-11-03

## Purpose

The only place that imports `@whiskeysockets/baileys`. Converts Baileys objects into domain events, keeps the WhatsApp session encrypted at rest, and defines the gateway interface the rest of the daemon uses. Also owns the live Baileys socket (`BaileysGateway`), its reconnect policy and the QR login flow.

## Structure

| File | Purpose |
|---|---|
| `src/whatsapp/types.ts` | `WaChat`, `WaMessage`, `WaEvent`, `ConnectionState`, `WhatsAppGateway` (no Baileys types leak) |
| `src/whatsapp/adapt.ts` | Baileys `WAMessage`/`Chat`/`Contact` to domain events |
| `src/whatsapp/auth-state.ts` | `useEncryptedAuthState`: AES-GCM file-per-key auth store |
| `src/whatsapp/session-crypto.ts` | `SessionCrypto` (AES-256-GCM) and `loadOrCreateAuthKey` (Keychain-backed key) |
| `src/whatsapp/backoff.ts` | Reconnect delay schedule |
| `src/whatsapp/connection.ts` | `ReconnectController`: reconnect policy (stable-open reset, never gives up on retry-class closes), Baileys-free |
| `src/whatsapp/events.ts` | Pure Baileys event payload to `WaEvent[]` mapping, `closeReason` |
| `src/whatsapp/gateway.ts` | `createSocket` (shared socket options) and `BaileysGateway` |
| `src/whatsapp/login.ts` | `runLogin` (QR pairing in the terminal), `linkStatus`, `wipeAuthDir`, `prepareLogin`, `runLogout` |
| `src/testing/fake-gateway.ts` | `FakeGateway`: records calls (including `stop`), `emit(e)` pushes events |
| `src/testing/fixtures.ts` | `waMessage()` builder with fake JIDs |

## Public surface

- `WhatsAppGateway` (`types.ts:29`): `onEvent`, `sendText`, `markRead`, `setArchived`, `setMuted`, `leaveGroup`, `groupTitle`, `state`, `stop` (`types.ts:39`, daemon shutdown).
- `WaMessage` (`types.ts:16`) is `NewMessage` minus `sentViaWasap` plus `senderAltJid`; `chatId` is as Baileys gave it (may be `@lid`).
- `MessageKeyRef` is re-exported from `src/store/types.ts`.
- `BaileysGateway.start({ authDir, crypto, getMessageText, logger })` (`gateway.ts:90`) and `stop()` (`gateway.ts:103`). `start` throws `AUTH_REQUIRED` with `NOT_LINKED` (`gateway.ts:53`) when creds have no `me`, and with `UNREADABLE_SESSION` (`gateway.ts:54`) plus `describeError` when the auth state can't be decrypted.
- `runLogin({ authDir, crypto, print })` (`login.ts:24`) resolves `{ meJid }` (normalized, no device suffix).
- `linkStatus(authDir, crypto)` (`login.ts:100`): `'linked'` (creds carry `me`), `'not_linked'`, or `'unreadable'` (any failure to decrypt/parse; files untouched).
- `wipeAuthDir(authDir)` (`login.ts:111`): removes every entry with plain fs, no decryption; no-op for a missing dir.
- `prepareLogin(authDir, crypto, force)` (`login.ts:125`): `force` wipes and returns `'ready'`; otherwise `'already_linked'`, `'unreadable'` or `'ready'`.
- `runLogout({ authDir, crypto, timeoutMs? })` (`login.ts:148`) resolves `LogoutResult` (`login.ts:144`): `'not_linked'` (nothing touched), `'local_only'` without connecting when the session is unreadable (wiped with `wipeAuthDir`), `'remote'` (socket opened and `sock.logout()` sent `remove-companion-device`), `'local_only'` (could not open within `timeoutMs`, default 30 s, or the call failed). The auth dir is cleared in both linked cases.
- `ReconnectController` (`connection.ts:14`): `handleClose('logged_out' | 'terminal' | 'other')`, `handleOpen()`, `stop()`.

## Key methods

- `extractText` `adapt.ts:12`: priority `conversation`, `extendedTextMessage.text`, image/video/document caption, after `normalizeMessageContent` unwraps ephemeral/view-once/document-with-caption.
- `mediaKind` `adapt.ts:25`.
- `toWaEvents` `adapt.ts:64`: one `messages` event; `protocolMessage` REVOKE/MESSAGE_EDIT become `revoke`/`edit` keyed by `protocolMessage.key.id` with the outer `remoteJid`; reactions, other protocol messages, key-distribution-only, `status@broadcast`, newsletters and messages with no text and no media kind give `[]`.
- `toWaChat` `adapt.ts:104`: see unread gotcha.
- `toContactPairs` `adapt.ts:136`: names plus `lid`/`pn` alias pairs from Baileys contacts.
- `useEncryptedAuthState` `auth-state.ts:28`: files `0600` in a `0700` dir, names sanitized to `[A-Za-z0-9._-]`, write-then-rename; `clear()` deletes every file in the dir but not the dir.
- `loadOrCreateAuthKey` `session-crypto.ts:37`: reads `SECRET_ACCOUNTS.authKey` (64 hex), creates one if missing.
- `nextDelayMs` `backoff.ts:7`: 2s base, x2, 300s cap, +-20% jitter via injectable `random`; from attempt 10 (`maxAttempts`) it stays at the cap forever (never `null`).
- `skipChat` `adapt.ts:57`: `status@broadcast` and `@newsletter` are dropped everywhere.
- `fromMuteMs` `adapt.ts:123` / `toMuteMs` `adapt.ts:131`: mute units. See the mute gotcha.
- `ReconnectController.handleClose` `connection.ts:31`: `'logged_out'` emits `logged_out` and is terminal; `'terminal'` emits `gave_up` without any retry; `'other'` emits `reconnecting`, sleeps `delay(attempt)`, calls `connect`, and retries in-loop only if `connect` throws. Retry-class closes never give up: past `BACKOFF.maxAttempts` the delay stays at `capMs` (300 s, ±20% jitter). A close arriving while a reconnect is in flight is ignored. `handleOpen` (`connection.ts:52`) does **not** reset the attempt counter right away: it schedules a reset after `STABLE_OPEN_MS` (60 s, `connection.ts:5`) through the injected `schedule`, and any close (or `stop`) cancels that pending reset, so open-then-close flapping keeps backing off instead of retrying every ~2 s. `stop` (`connection.ts:61`) makes it terminal, dropping a sleeping attempt.
- `createSocket` `gateway.ts:31`, socket options and why:
  - `auth` with `makeCacheableSignalKeyStore` over the encrypted store (avoids a disk read+decrypt per signal key).
  - `markOnlineOnConnect: false`: the phone keeps getting notifications and contacts don't see us online.
  - `syncFullHistory: true` + `browser: Browsers.macOS('Desktop')`: Baileys only sets the desktop `webSubPlatform` when both hold (`Utils/validate-connection.ts` `getWebInfo`), which makes the phone send full history instead of ~3 months. `syncFullHistory` is also sent as `requireFullSync` in the pairing payload, so login must use the same options (hence the shared builder).
  - `shouldSyncHistoryMessage: () => true`: process every history chunk type.
  - `getMessage`: returns `{ conversation: text }` from the store so retry receipts (peer asks us to re-encrypt a sent message) work; `undefined` when unknown.
  - `logger`: child at `warn` (or the parent's level if quieter); Baileys' debug/trace logs contain full message objects.
- Event processing (`connect`, `gateway.ts:192`): each `ev.process` batch runs three steps, each wrapped in `guardEvents` (`events.ts:105`): creds save, data mapping (`handleData` `gateway.ts:216`), connection handling. Baileys' `ev.process` awaits the handler without catching (`Utils/event-buffer.ts` `process`), so an uncaught throw would be an unhandledRejection that crashes the daemon. A failure is logged at `error` with `describeError` only, and one failed step doesn't skip the others (a bad creds write must not hide a close).
- Event mapping (`events.ts`):
  - `messaging-history.set` → `mapHistorySet` (`events.ts:49`): `aliases` (from `lidPnMappings` when present, else chats' `lidJid`/`pnJid`, plus contacts' lid/pn; deduped), `contacts`, `chats` (history source), `messages`, then edit/revoke events. Aliases go first so ids can be resolved before storing.
  - `chats.upsert` → `chats` (history source); `chats.update` → `chats` (update source); `mapChats` `events.ts:30` skips entries without `id`.
  - `messages.upsert` (both `notify` and `append`) → `mapMessages` `events.ts:18`: one merged `messages` event plus separate `edit`/`revoke`.
  - `contacts.upsert`/`contacts.update` → `mapContacts` `events.ts:41`: `contacts` with `name ?? notify` only, plus any `aliases` the contacts carry.
  - `connection.update` `gateway.ts:228`: `open` → controller `handleOpen`, state `open`, then `groupFetchAllParticipating` once → `mapGroups` (`events.ts:62`, `unread: null`, `archived: null`, `mutedUntil: undefined`). `close` → `closeReason` (`events.ts:96`, Boom `output.statusCode` → `{ kind, code, name }`, logged at warn), classified by `classifyClose` (`events.ts:87`):
    - `logged_out` (401): emits `logged_out`, ends the socket, then `clear()`s the auth dir.
    - `terminal`: 440 `connectionReplaced`, 403 `forbidden`, 500 `badSession`, 411 `multideviceMismatch`. Emits `gave_up` with no retry, and the auth dir is kept. This is for ban safety: retrying fights another session or repeats a server refusal.
    - `restart_required` (515) and `retry` (all other codes, or none): exponential backoff through the controller, then retries every ~`capMs` indefinitely.
  - `creds.update` → `saveCreds()`.
- `markRead` `gateway.ts:126`: always `chatModify({ markRead: true, lastMessages: [minimal] })`; `readMessages([key])` (blue ticks) only when `last.fromMe === false`. `minimal` (`gateway.ts:270`) is `{ key: { remoteJid, id, fromMe, participant? }, messageTimestamp }`, matching Baileys' `MinimalMessage = Pick<WAMessage, 'key' | 'messageTimestamp'>`; `participant` = `senderJid` for groups only.
- `setArchived` `gateway.ts:135`: `chatModify({ archive, lastMessages: [minimal] })`.
- `setMuted` `gateway.ts:141`: `chatModify({ mute: toMuteMs(untilSec) })`. Baileys copies `mute` verbatim into the absolute `muteAction.muteEndTimestamp` (`Utils/chat-utils.ts` `chatModificationToAppPatch`). The Baileys README's "mute for 8 hours: `8*60*60*1000`" example reads as a duration, which is misleading.
- `sendText` `gateway.ts:119`: returns `{ waId: sent.key.id, ts: toNumber(sent.messageTimestamp) }`. A quote needs `quoted.message` (Baileys builds `contextInfo.quotedMessage` from it and crashes without one), so `quotedMessage` (`gateway.ts:166`) fills `{ conversation: storedText ?? '' }`.
- `groupTitle` `gateway.ts:149`: `groupMetadata(chatId).subject`, `null` on error.
- `runLogin` `login.ts:22`: prints QR with `qrcode-terminal` `{ small: true }`; on `open` waits for pending creds writes, ends the socket and resolves; one `restartRequired` (515) after pairing reconnects immediately (protocol, not a failure), a second rejects. `loggedOut` clears stale creds and rejects `LOGGED_OUT`; other closes reject `AUTH_REQUIRED` (`login.ts:83`). The stored creds-save chain has a no-op `.catch` so an early failure surfaces as `INTERNAL` from `finish`, not as an unhandledRejection.

## Dependencies

Baileys (`makeWASocket`, `makeCacheableSignalKeyStore`, `Browsers`, `DisconnectReason`, `jidNormalizedUser`, `normalizeMessageContent`, `toNumber`, `proto`, `BufferJSON`, `initAuthCreds`), `pino` (login's silent logger), `qrcode-terminal`, `src/daemon/logger.ts`, `src/domain/errors.ts`, `src/secrets/keychain.ts`, `src/store/types.ts` (types only). The caller supplies `getMessageText` (the daemon wires `MessagesRepo.getText`).

## Gotchas & invariants

- **LID**: Baileys 7 may give `@lid` chat ids; `senderAltJid` carries `participantAlt` (groups) or `remoteJidAlt` (DMs) so the caller can resolve aliases. Adapters never resolve them.
- **Unread**: history sync gives an absolute count (`-1` means marked unread); `chats.update` gives increments, so `toWaChat` emits `absolute` for `'history'` and `live` for `'update'` (and `null` when the update has no `unreadCount` key). Do not mix them up.
- **Mute units**: WhatsApp uses epoch **milliseconds** on the wire (`muteEndTime` in history, `muteAction.muteEndTimestamp` in app-state sync and in `chatModify({ mute })`), with `-1` meaning muted forever. wasap stores **seconds**. `fromMuteMs` maps `>0` to `Math.floor(ms / 1000)`, `-1` to `-1`, and `0`/`null`/`undefined` to `null` (unmuted). `toMuteMs` maps `null` to `null` (unmute), `-1` to `-1`, and seconds to `* 1000`. `WaChat.mutedUntil` is `undefined` when the event carried no mute key at all (no info), `null` when unmuted, `-1` when forever, and unix seconds otherwise.
- Timestamps are unix seconds via `toNumber` (Baileys may give `Long`).
- Edit/revoke `ts` is the outer message's timestamp, not the target's.
- A wrong auth key makes `useEncryptedAuthState` throw (GCM auth failure); never fall back to fresh creds on that error or the paired session is lost.
- Never log message text or names.
- `runLogout` does not save creds updates from its short-lived socket; the files are wiped right after. It clears locally even when the remote logout fails, so the phone may still list the device (the CLI tells the user to remove it there).
- **Gateway state**: methods throw `AppError('LOGGED_OUT')` when logged out and `AppError('INTERNAL', 'not connected (state: …)')` for any other non-`open` state (`gateway.ts:158`). `groupTitle` throws too when not open (only Baileys errors become `null`).
- `start` throws `AUTH_REQUIRED` when the creds have no `me` (never paired) or can't be decrypted (the files are not touched; recovery is `wasap login --force`). It resolves once the socket is created, not when it opens; register `onEvent` right after `start` resolves (events are network-driven, so none fire before then).
- `logged_out` and `gave_up` are terminal for the process: nothing reconnects until the daemon restarts (after `wasap login` for the former). `gave_up` comes only from a terminal close code (the warn log names it); network-style failures stay in `reconnecting`. A 515 on the daemon's socket is handled by the normal backoff (first retry ~2s).
- On `loggedOut` the order is: emit `logged_out`, end socket, then `clear()`; clearing first lets a queued `creds.update` write recreate files.
- Events from a replaced socket are ignored (`sock !== this.sock` guard in `connect`, `gateway.ts:192`).
- The reconnect sleep timer is unref'd so a pending retry never keeps a stopping process alive.
- **Login and history**: the login socket ends right after `open`. History chunks it already processed in that window are dropped (no one listens); unprocessed ones are redelivered to the daemon's socket. Verify in the live run.
- `messaging-history.set` field names match the brief (`chats`, `contacts`, `messages`, `lidPnMappings?` — `Types/Events.d.ts:18`). Baileys' own `Utils/history` already merges chat `lidJid`/`pnJid` into `lidPnMappings`, so the chats fallback only matters when the field is absent.

## Testing

`adapt.test.ts`, `auth-state.test.ts`, `session-crypto.test.ts`, `backoff.test.ts`, `connection.test.ts` (reconnect policy with fake `connect`/`sleep`/`delay`), `events.test.ts` (event mapping, `classifyClose`/`closeReason`, `guardEvents` with fake payloads and fake JIDs), `login.test.ts` (`linkStatus`, `wipeAuthDir`, `prepareLogin` and `runLogout` including a session encrypted under another key; temp dirs, no network); `adapt.test.ts` also covers the mute ms/seconds conversion. Run `pnpm vitest run src/whatsapp`. `BaileysGateway`, `runLogin` and the network path of `runLogout` are not unit-tested (they need a live socket); they are verified manually against a real account.
