import { describe, expect, it } from 'vitest';
import { MemorySecretStore } from '../testing/memory-secrets.js';
import { ensureBearerToken } from './token.js';

describe('ensureBearerToken', () => {
  it('generates a hex token once and reuses it', async () => {
    const secrets = new MemorySecretStore();
    const first = await ensureBearerToken(secrets);
    // Hex, never base64url: a leading '-' could be mis-parsed inside `security -i`.
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await ensureBearerToken(secrets)).toBe(first);
  });
});
