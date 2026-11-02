import { jidNormalizedUser, type BaileysEventMap, type WASocket } from '@whiskeysockets/baileys';
import { pino } from 'pino';
import qrcode from 'qrcode-terminal';
import { AppError, describeError } from '../domain/errors.js';
import { useEncryptedAuthState } from './auth-state.js';
import { closeReason } from './events.js';
import { createSocket } from './gateway.js';
import type { SessionCrypto } from './session-crypto.js';

export interface LoginOptions {
  authDir: string;
  crypto: SessionCrypto;
  print: (s: string) => void;
}

type Auth = Awaited<ReturnType<typeof useEncryptedAuthState>>;
type Attempt = { kind: 'open'; meJid: string } | { kind: 'restart' } | { kind: 'failed'; error: AppError };

/// Pairs this device by QR. After a successful scan WhatsApp closes the stream
/// with restartRequired (515) and expects a fresh socket with the new creds;
/// that single restart is part of the protocol, not a failure.
export async function runLogin(o: LoginOptions): Promise<{ meJid: string }> {
  const auth = await useEncryptedAuthState(o.authDir, o.crypto);
  let restarted = false;
  for (;;) {
    const result = await attempt(auth, o.print);
    if (result.kind === 'open') return { meJid: result.meJid };
    if (result.kind === 'restart' && !restarted) {
      restarted = true;
      continue;
    }
    throw result.kind === 'failed' ? result.error : new AppError('AUTH_REQUIRED', 'WhatsApp kept restarting the login; try again');
  }
}

function attempt(auth: Auth, print: (s: string) => void): Promise<Attempt> {
  // Silent: the terminal is showing a QR code, and Baileys' own logs are noise there.
  const sock = createSocket({ auth: auth.state, logger: pino({ level: 'silent' }), getMessageText: () => null });
  let saving: Promise<void> = Promise.resolve();
  sock.ev.on('creds.update', () => {
    saving = saving.then(() => auth.saveCreds());
    // Observed so an early failure isn't an unhandledRejection; `finish` still
    // awaits the real chain and turns the failure into an INTERNAL error.
    saving.catch(() => undefined);
  });

  return new Promise<Attempt>((resolve) => {
    // Ending the socket emits its own close; only the first outcome counts.
    let done = false;
    sock.ev.on('connection.update', (u: BaileysEventMap['connection.update']) => {
      if (done) return;
      if (u.qr) qrcode.generate(u.qr, { small: true }, (code: string) => print(code));
      if (u.connection === 'open' || u.connection === 'close') done = true;
      if (u.connection === 'open') {
        // Close right away: history sync belongs to the daemon's socket, and anything
        // this socket has not processed is redelivered to the next one.
        void finish(sock, () => saving, () => openResult(sock, auth)).then(resolve, (err: unknown) => resolve(saveFailed(err)));
      } else if (u.connection === 'close') {
        const error: unknown = u.lastDisconnect?.error;
        void finish(sock, () => saving, () => closeResult(error, auth)).then(resolve, (err: unknown) => resolve(saveFailed(err)));
      }
    });
  });
}

/// Pending creds writes must land before the socket goes away, or the pairing is lost.
async function finish(sock: WASocket, saving: () => Promise<void>, result: () => Promise<Attempt> | Attempt): Promise<Attempt> {
  await saving();
  await sock.end(undefined);
  return result();
}

function saveFailed(err: unknown): Attempt {
  return { kind: 'failed', error: new AppError('INTERNAL', `Could not store the WhatsApp session: ${describeError(err)}`) };
}

function openResult(sock: WASocket, auth: Auth): Attempt {
  const id = sock.user?.id ?? auth.state.creds.me?.id;
  if (!id) return { kind: 'failed', error: new AppError('INTERNAL', 'WhatsApp opened without an account id') };
  return { kind: 'open', meJid: jidNormalizedUser(id) };
}

async function closeResult(err: unknown, auth: Auth): Promise<Attempt> {
  const reason = closeReason(err).kind;
  if (reason === 'restart_required') return { kind: 'restart' };
  if (reason === 'logged_out') {
    // Stale creds from an earlier, revoked link: clear them so the next run shows a QR.
    await auth.clear();
    return { kind: 'failed', error: new AppError('LOGGED_OUT', 'The previous WhatsApp link was revoked and has been cleared; run `wasap login` again') };
  }
  return { kind: 'failed', error: new AppError('AUTH_REQUIRED', 'WhatsApp login did not complete (QR expired or connection lost); try again') };
}

/// True when the auth dir holds a paired device (creds carry `me`).
export async function isLinked(authDir: string, crypto: SessionCrypto): Promise<boolean> {
  const auth = await useEncryptedAuthState(authDir, crypto);
  return !!auth.state.creds.me;
}

/// Deletes the local session files; the phone still lists the device until it is removed there.
export async function clearLink(authDir: string, crypto: SessionCrypto): Promise<void> {
  await (await useEncryptedAuthState(authDir, crypto)).clear();
}

export interface LogoutOptions {
  authDir: string;
  crypto: SessionCrypto;
  /// How long to wait for the socket to open before giving up on the remote logout.
  timeoutMs?: number;
}

/// `remote`: WhatsApp removed the linked device. `local_only`: we could not reach
/// WhatsApp (or it had already revoked us), so only the local session was cleared.
export type LogoutResult = 'not_linked' | 'remote' | 'local_only';

/// Unlinks this device from the account, then clears the local session either way:
/// the user asked to log out, and a half-cleared session is worse than none.
export async function runLogout(o: LogoutOptions): Promise<LogoutResult> {
  const auth = await useEncryptedAuthState(o.authDir, o.crypto);
  if (!auth.state.creds.me) return 'not_linked';
  // Creds updates during this short connection are not saved: the files are wiped right after.
  const sock = createSocket({ auth: auth.state, logger: pino({ level: 'silent' }), getMessageText: () => null });
  let remote = false;
  try {
    await waitForOpen(sock, o.timeoutMs ?? 30_000);
    await sock.logout();
    remote = true;
  } catch {
    await sock.end(undefined);
  }
  await auth.clear();
  return remote ? 'remote' : 'local_only';
}

function waitForOpen(sock: WASocket, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AppError('INTERNAL', 'timed out connecting to WhatsApp')), timeoutMs);
    sock.ev.on('connection.update', (u: BaileysEventMap['connection.update']) => {
      if (u.connection === 'open') {
        clearTimeout(timer);
        resolve();
      } else if (u.connection === 'close') {
        clearTimeout(timer);
        reject(new AppError('INTERNAL', `WhatsApp closed the connection (${closeReason(u.lastDisconnect?.error).name})`));
      }
    });
  });
}
