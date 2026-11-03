import { spawn } from 'node:child_process';
import { AppError } from '../domain/errors.js';

export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
}

export interface CommandRunner {
  run(args: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }>;
}

export const SECRET_ACCOUNTS = { bearerToken: 'bearer_token', authKey: 'auth_key' } as const;

const SERVICE = 'wasap';
// security(1) exit status for errSecItemNotFound.
const ITEM_NOT_FOUND = 44;
// Values are interpolated into a `security -i` command line, so only allow
// characters that can't start a new argument or command (base64, hex, tokens).
const SAFE_VALUE = /^[A-Za-z0-9+/=_.:-]+$/;

export const securityCli: CommandRunner = {
  run(args: string[], stdin?: string) {
    return new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
      // EPIPE when security exits before reading stdin would otherwise be an
      // uncaught 'error' event; the close/error handlers already report failure.
      child.stdin.on('error', () => {});
      child.stdin.end(stdin ?? '');
    });
  },
};

/// macOS Keychain via the built-in `security` CLI, so there's no native
/// dependency. Writes go through `security -i` on stdin: secrets never appear
/// in argv, where any local process could read them from the process list.
export class Keychain implements SecretStore {
  constructor(
    private readonly runner: CommandRunner = securityCli,
    private readonly service: string = SERVICE,
  ) {}

  async get(account: string): Promise<string | null> {
    const r = await this.runner.run(['find-generic-password', '-s', this.service, '-a', account, '-w']);
    if (r.code === ITEM_NOT_FOUND) return null;
    if (r.code !== 0) throw new AppError('INTERNAL', `keychain read failed for ${account} (exit ${r.code})`);
    return r.stdout.replace(/\n$/, '');
  }

  async set(account: string, value: string): Promise<void> {
    assertSafe(account);
    assertSafe(value);
    const r = await this.runner.run(['-i'], `add-generic-password -U -s ${this.service} -a ${account} -w ${value}\n`);
    if (r.code !== 0) throw new AppError('INTERNAL', `keychain write failed for ${account} (exit ${r.code})`);
  }

  async delete(account: string): Promise<void> {
    const r = await this.runner.run(['delete-generic-password', '-s', this.service, '-a', account]);
    if (r.code !== 0 && r.code !== ITEM_NOT_FOUND) {
      throw new AppError('INTERNAL', `keychain delete failed for ${account} (exit ${r.code})`);
    }
  }
}

function assertSafe(value: string): void {
  if (!SAFE_VALUE.test(value)) throw new AppError('VALIDATION', 'keychain values must be base64/hex/token characters');
}
