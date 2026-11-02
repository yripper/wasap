import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEncryptedAuthState } from './auth-state.js';
import { clearLink, isLinked, runLogout } from './login.js';
import { SessionCrypto } from './session-crypto.js';

let dir: string;
const crypto = new SessionCrypto(randomBytes(32));

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

describe('link helpers', () => {
  it('isLinked is false for an empty auth dir and true once creds carry me', async () => {
    expect(await isLinked(dir, crypto)).toBe(false);
    await pair();
    expect(await isLinked(dir, crypto)).toBe(true);
  });

  it('clearLink removes the session files', async () => {
    await pair();
    await clearLink(dir, crypto);
    expect(readdirSync(dir)).toEqual([]);
    expect(await isLinked(dir, crypto)).toBe(false);
  });

  it('runLogout does nothing when no device is linked', async () => {
    expect(await runLogout({ authDir: dir, crypto })).toBe('not_linked');
    expect(readdirSync(dir)).toEqual([]);
  });
});
