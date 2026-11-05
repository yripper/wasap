import { describe, expect, it } from 'vitest';
import { Keychain } from './keychain.js';
import { SecretTool } from './secret-tool.js';
import { createSecretStore } from './store.js';

describe('createSecretStore', () => {
  it('uses the macOS Keychain on darwin', () => {
    expect(createSecretStore('darwin')).toBeInstanceOf(Keychain);
  });

  it('uses libsecret secret-tool on linux', () => {
    expect(createSecretStore('linux')).toBeInstanceOf(SecretTool);
  });

  it('refuses any other platform with a clear error', () => {
    expect(() => createSecretStore('win32')).toThrow(/not supported on win32.*macOS.*Linux/);
  });
});
