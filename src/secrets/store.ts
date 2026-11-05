import { AppError } from '../domain/errors.js';
import { Keychain, type SecretStore } from './keychain.js';
import { SecretTool } from './secret-tool.js';

/// The OS secret store for this platform. There is deliberately no plaintext
/// fallback: an unsupported platform or a missing tool fails loudly instead.
export function createSecretStore(platform: NodeJS.Platform = process.platform): SecretStore {
  if (platform === 'darwin') return new Keychain();
  if (platform === 'linux') return new SecretTool();
  throw new AppError('INTERNAL', `wasap is not supported on ${platform}: secrets need the macOS Keychain or a Linux keyring (libsecret)`);
}
