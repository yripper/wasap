import crypto from 'node:crypto';
import { SECRET_ACCOUNTS, type SecretStore } from '../secrets/keychain.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const HEX_KEY = /^[0-9a-f]{64}$/i;

/// AES-256-GCM; payload layout is iv | ciphertext | authTag.
export class SessionCrypto {
  constructor(private readonly key: Buffer) {
    if (key.length !== KEY_LENGTH) {
      throw new Error(`SessionCrypto key must be ${KEY_LENGTH} bytes, got ${key.length}`);
    }
  }

  encrypt(plaintext: Buffer): Buffer {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
  }

  decrypt(payload: Buffer): Buffer {
    if (payload.length < IV_LENGTH + TAG_LENGTH) throw new Error('Ciphertext too short');
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(payload.length - TAG_LENGTH);
    const ciphertext = payload.subarray(IV_LENGTH, payload.length - TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

/// The key lives in the OS secret store (Keychain or libsecret keyring), never on disk next to the encrypted session files.
export async function loadOrCreateAuthKey(secrets: SecretStore): Promise<SessionCrypto> {
  const existing = await secrets.get(SECRET_ACCOUNTS.authKey);
  if (existing !== null) {
    if (!HEX_KEY.test(existing)) throw new Error('Stored auth key is not 64 hex characters');
    return new SessionCrypto(Buffer.from(existing, 'hex'));
  }
  const hex = crypto.randomBytes(KEY_LENGTH).toString('hex');
  await secrets.set(SECRET_ACCOUNTS.authKey, hex);
  return new SessionCrypto(Buffer.from(hex, 'hex'));
}
