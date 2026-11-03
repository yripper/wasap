import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEncryptedAuthState } from './auth-state.js';
import { linkStatus, loginFailureMessage, prepareLogin, runLogout, wipeAuthDir } from './login.js';
import { SessionCrypto } from './session-crypto.js';

let dir: string;
const crypto = new SessionCrypto(randomBytes(32));
const otherKey = new SessionCrypto(randomBytes(32));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wasap-login-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function pair(): Promise<void> {
  const auth = await useEncryptedAuthState(dir, crypto);
  auth.state.creds.me = { id: '111:1@s.whatsapp.net' };
  await auth.saveCreds();
}

const snapshot = (): Record<string, string> =>
  Object.fromEntries(readdirSync(dir).map((n) => [n, readFileSync(join(dir, n)).toString('hex')]));

describe('link helpers', () => {
  it('linkStatus is not_linked for an empty auth dir and linked once creds carry me', async () => {
    expect(await linkStatus(dir, crypto)).toBe('not_linked');
    await pair();
    expect(await linkStatus(dir, crypto)).toBe('linked');
  });

  it('linkStatus is unreadable under a different key and leaves the files alone', async () => {
    await pair();
    const before = snapshot();
    expect(await linkStatus(dir, otherKey)).toBe('unreadable');
    expect(snapshot()).toEqual(before);
  });

  it('wipeAuthDir removes the files without decrypting them', async () => {
    await pair();
    await wipeAuthDir(dir);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('wipeAuthDir is a no-op for a missing dir', async () => {
    await expect(wipeAuthDir(join(dir, 'missing'))).resolves.toBeUndefined();
  });

  it('prepareLogin refuses a linked session without force', async () => {
    await pair();
    expect(await prepareLogin(dir, crypto, false)).toBe('already_linked');
    expect(await linkStatus(dir, crypto)).toBe('linked');
  });

  it('prepareLogin refuses an unreadable session without force and keeps it', async () => {
    await pair();
    const before = snapshot();
    expect(await prepareLogin(dir, otherKey, false)).toBe('unreadable');
    expect(snapshot()).toEqual(before);
  });

  it('prepareLogin with force wipes a session encrypted under another key', async () => {
    await pair();
    expect(await prepareLogin(dir, otherKey, true)).toBe('ready');
    expect(readdirSync(dir)).toEqual([]);
    expect(await linkStatus(dir, otherKey)).toBe('not_linked');
  });

  it('prepareLogin is ready when nothing is linked', async () => {
    expect(await prepareLogin(dir, crypto, false)).toBe('ready');
  });

  it('runLogout does nothing when no device is linked', async () => {
    expect(await runLogout({ authDir: dir, crypto })).toBe('not_linked');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('runLogout clears an unreadable session locally without connecting', async () => {
    await pair();
    expect(await runLogout({ authDir: dir, crypto: otherKey })).toBe('local_only');
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('loginFailureMessage', () => {
  it('names the real reason and code instead of a generic guess', () => {
    expect(loginFailureMessage({ code: 408, name: 'timedOut' })).toBe('WhatsApp login did not complete: the QR code expired before it was scanned (408); run `wasap login` again');
    expect(loginFailureMessage({ code: 428, name: 'connectionClosed' })).toBe('WhatsApp login did not complete: WhatsApp closed the connection (connectionClosed, 428); try again in a minute');
    expect(loginFailureMessage({ code: null, name: 'unknown' })).toBe('WhatsApp login did not complete: the connection dropped (no status code); try again');
  });
});
