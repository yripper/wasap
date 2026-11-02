import type { SecretStore } from '../secrets/keychain.js';

export class MemorySecretStore implements SecretStore {
  readonly items = new Map<string, string>();
  async get(account: string): Promise<string | null> {
    return this.items.get(account) ?? null;
  }
  async set(account: string, value: string): Promise<void> {
    this.items.set(account, value);
  }
  async delete(account: string): Promise<void> {
    this.items.delete(account);
  }
}
