import { describe, expect, it } from 'vitest';
import { MemorySecretStore } from '../testing/memory-secrets.js';
import { SECRET_ACCOUNTS } from '../secrets/keychain.js';
import { SessionCrypto, loadOrCreateAuthKey } from './session-crypto.js';

const key = (b: number): Buffer => Buffer.alloc(32, b);

describe('SessionCrypto', () => {
  it('round-trips', () => {
    const c = new SessionCrypto(key(1));
    expect(c.decrypt(c.encrypt(Buffer.from('hello'))).toString()).toBe('hello');
  });
  it('detects tampering', () => {
    const c = new SessionCrypto(key(1));
    const blob = c.encrypt(Buffer.from('hello'));
    blob[14] = (blob[14] ?? 0) ^ 1;
    expect(() => c.decrypt(blob)).toThrow();
  });
  it('rejects a wrong key', () => {
    const blob = new SessionCrypto(key(1)).encrypt(Buffer.from('hello'));
    expect(() => new SessionCrypto(key(2)).decrypt(blob)).toThrow();
  });
  it('rejects short keys and short payloads', () => {
    expect(() => new SessionCrypto(Buffer.alloc(8))).toThrow();
    expect(() => new SessionCrypto(key(1)).decrypt(Buffer.alloc(5))).toThrow('too short');
  });
});

describe('loadOrCreateAuthKey', () => {
  it('generates and stores a 64-hex key, then reuses it', async () => {
    const secrets = new MemorySecretStore();
    const a = await loadOrCreateAuthKey(secrets);
    expect(secrets.items.get(SECRET_ACCOUNTS.authKey)).toMatch(/^[0-9a-f]{64}$/);
    const b = await loadOrCreateAuthKey(secrets);
    expect(b.decrypt(a.encrypt(Buffer.from('x'))).toString()).toBe('x');
  });
  it('rejects a malformed stored key', async () => {
    const secrets = new MemorySecretStore();
    await secrets.set(SECRET_ACCOUNTS.authKey, 'nothex');
    await expect(loadOrCreateAuthKey(secrets)).rejects.toThrow();
  });
});
