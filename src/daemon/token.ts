import { randomBytes } from 'node:crypto';
import { SECRET_ACCOUNTS, type SecretStore } from '../secrets/keychain.js';

/// Hex, not base64url: a base64url token can start with '-', which may be
/// mis-parsed as a flag inside the `security -i` command line.
export async function ensureBearerToken(secrets: SecretStore): Promise<string> {
  const existing = await secrets.get(SECRET_ACCOUNTS.bearerToken);
  if (existing) return existing;
  const token = randomBytes(32).toString('hex');
  await secrets.set(SECRET_ACCOUNTS.bearerToken, token);
  return token;
}
