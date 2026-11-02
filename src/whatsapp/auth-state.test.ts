import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BufferJSON } from '@whiskeysockets/baileys';
import { useEncryptedAuthState } from './auth-state.js';
import { SessionCrypto } from './session-crypto.js';

const crypto1 = new SessionCrypto(Buffer.alloc(32, 1));
const crypto2 = new SessionCrypto(Buffer.alloc(32, 2));
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wasap-auth-'));
});
afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await rm(dir, { recursive: true, force: true });
});

describe('useEncryptedAuthState', () => {
  it('persists creds and reloads them with the same key', async () => {
    const a = await useEncryptedAuthState(dir, crypto1);
    await a.saveCreds();
    const b = await useEncryptedAuthState(dir, crypto1);
    expect(JSON.stringify(b.state.creds, BufferJSON.replacer)).toBe(JSON.stringify(a.state.creds, BufferJSON.replacer));
  });

  it('throws when reloading with a different key', async () => {
    const a = await useEncryptedAuthState(dir, crypto1);
    await a.saveCreds();
    await expect(useEncryptedAuthState(dir, crypto2)).rejects.toThrow();
  });

  it('never writes plaintext to disk and uses 0600 files', async () => {
    const a = await useEncryptedAuthState(dir, crypto1);
    await a.saveCreds();
    const files = await readdir(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect((await readFile(path.join(dir, f))).toString('latin1')).not.toContain('noiseKey');
      expect((await stat(path.join(dir, f))).mode & 0o777).toBe(0o600);
    }
  });

  it('stores, reads and deletes signal keys with sanitized names', async () => {
    const a = await useEncryptedAuthState(dir, crypto1);
    await a.state.keys.set({ session: { '111:2@s.whatsapp.net': new Uint8Array([1, 2, 3]) } });
    expect((await readdir(dir)).every((f) => /^[A-Za-z0-9._-]+$/.test(f))).toBe(true);
    const got = await a.state.keys.get('session', ['111:2@s.whatsapp.net', 'missing']);
    expect(Array.from(got['111:2@s.whatsapp.net'] ?? [])).toEqual([1, 2, 3]);
    expect(got['missing']).toBeUndefined();
    await a.state.keys.set({ session: { '111:2@s.whatsapp.net': null } });
    expect(await a.state.keys.get('session', ['111:2@s.whatsapp.net'])).toEqual({});
  });

  it('clear deletes every file but keeps the directory', async () => {
    const a = await useEncryptedAuthState(dir, crypto1);
    await a.saveCreds();
    await a.clear();
    expect(await readdir(dir)).toEqual([]);
  });

  it('serializes overlapping writes to the same key without leaving temp files', async () => {
    const a = await useEncryptedAuthState(dir, crypto1);
    await Promise.all(Array.from({ length: 20 }, () => a.saveCreds()));
    const writes = Array.from({ length: 20 }, (_, i) => a.state.keys.set({ session: { s: new Uint8Array([i]) } }));
    await expect(Promise.all(writes)).resolves.toBeDefined();
    const got = await a.state.keys.get('session', ['s']);
    expect(Array.from(got['s'] ?? [])).toEqual([19]);
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const b = await useEncryptedAuthState(dir, crypto1);
    expect(b.state.creds.registrationId).toBe(a.state.creds.registrationId);
  });
});
