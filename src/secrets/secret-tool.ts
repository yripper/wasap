import { AppError } from '../domain/errors.js';
import { assertSafe, type CommandRunner, SECRET_SERVICE, type SecretStore, spawnRunner } from './keychain.js';

type RunResult = { code: number; stdout: string; stderr: string };

const MISSING_BINARY =
  'secret-tool not found: wasap stores its secrets in the system keyring through libsecret. Install it with `sudo apt install libsecret-tools` (Ubuntu/Debian) and try again';
const MAX_REASON = 200;

/// Resolved through PATH: distros install it in /usr/bin, but don't hardcode it.
export const secretToolCli: CommandRunner = spawnRunner('secret-tool');

/// Linux keyring (GNOME Keyring or any Secret Service provider) via libsecret's
/// `secret-tool`. The value goes on stdin, never in argv, where any local
/// process could read it from the process list.
export class SecretTool implements SecretStore {
  constructor(
    private readonly runner: CommandRunner = secretToolCli,
    private readonly service: string = SECRET_SERVICE,
  ) {}

  async get(account: string): Promise<string | null> {
    const r = await this.exec(['lookup', ...this.attributes(account)]);
    // secret-tool reports "not found" as exit 1 with nothing on stderr; a
    // locked or unreachable keyring also exits 1 but says why on stderr.
    if (r.code !== 0 && isNotFound(r)) return null;
    if (r.code !== 0) throw failure('read', account, r);
    const value = r.stdout.replace(/\n$/, '');
    return value === '' ? null : value;
  }

  async set(account: string, value: string): Promise<void> {
    assertSafe(account);
    assertSafe(value);
    // No trailing newline: with stdin not a TTY, secret-tool stores every byte it reads.
    const r = await this.exec(['store', `--label=${this.service} ${account}`, ...this.attributes(account)], value);
    if (r.code !== 0) throw failure('write', account, r);
  }

  async delete(account: string): Promise<void> {
    const r = await this.exec(['clear', ...this.attributes(account)]);
    if (r.code !== 0 && !isNotFound(r)) throw failure('delete', account, r);
  }

  private attributes(account: string): string[] {
    return ['service', this.service, 'account', account];
  }

  private async exec(args: string[], stdin?: string): Promise<RunResult> {
    try {
      return await this.runner.run(args, stdin);
    } catch (e) {
      if (isMissingBinary(e)) throw new AppError('INTERNAL', MISSING_BINARY);
      throw e;
    }
  }
}

function isNotFound(r: RunResult): boolean {
  return r.code === 1 && r.stderr.trim() === '';
}

function isMissingBinary(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 'ENOENT';
}

/// stderr is safe to surface: the value only ever travels on stdin, and it's
/// the only place secret-tool explains a locked keyring or a missing D-Bus session.
function failure(op: string, account: string, r: RunResult): AppError {
  const reason = r.stderr.trim().split('\n')[0]?.slice(0, MAX_REASON);
  return new AppError('INTERNAL', `keyring ${op} failed for ${account} (exit ${r.code})${reason ? `: ${reason}` : ''}`);
}
