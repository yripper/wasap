import { describe, expect, it } from 'vitest';
import { AppError } from '../domain/errors.js';
import { type CommandRunner, Keychain } from './keychain.js';

class FakeRunner implements CommandRunner {
  readonly calls: { args: string[]; stdin?: string }[] = [];
  constructor(private readonly result: { code: number; stdout: string; stderr: string }) {}
  async run(args: string[], stdin?: string) {
    this.calls.push({ args, stdin });
    return this.result;
  }
}

const ok = (stdout = ''): FakeRunner => new FakeRunner({ code: 0, stdout, stderr: '' });

describe('Keychain', () => {
  it('get returns the secret without the trailing newline', async () => {
    const runner = ok('s3cr3t\n');
    expect(await new Keychain(runner).get('auth_key')).toBe('s3cr3t');
    expect(runner.calls[0]?.args).toEqual(['find-generic-password', '-s', 'wasap', '-a', 'auth_key', '-w']);
  });

  it('get returns null when the item does not exist (exit 44)', async () => {
    expect(await new Keychain(new FakeRunner({ code: 44, stdout: '', stderr: '' })).get('x')).toBeNull();
  });

  it('get throws INTERNAL on any other failure', async () => {
    await expect(new Keychain(new FakeRunner({ code: 1, stdout: '', stderr: 'boom' })).get('x')).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });

  it('set sends the secret through stdin, never argv', async () => {
    const runner = ok();
    await new Keychain(runner).set('auth_key', 'abc+/=123');
    expect(runner.calls[0]?.args).toEqual(['-i']);
    expect(runner.calls[0]?.stdin).toBe('add-generic-password -U -s wasap -a auth_key -w abc+/=123\n');
  });

  it('set rejects values that could break the interactive command line', async () => {
    const runner = ok();
    await expect(new Keychain(runner).set('auth_key', 'a b')).rejects.toBeInstanceOf(AppError);
    await expect(new Keychain(runner).set('auth_key', 'a"b')).rejects.toBeInstanceOf(AppError);
    await expect(new Keychain(runner).set('auth_key', 'a\nb')).rejects.toBeInstanceOf(AppError);
    expect(runner.calls).toHaveLength(0);
  });

  it('set throws INTERNAL when security exits non-zero', async () => {
    await expect(new Keychain(new FakeRunner({ code: 1, stdout: '', stderr: '' })).set('a', 'b')).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });

  it('delete treats a missing item as success', async () => {
    await expect(new Keychain(new FakeRunner({ code: 44, stdout: '', stderr: '' })).delete('x')).resolves.toBeUndefined();
  });
});

// Opt-in: touches the real login keychain under a throwaway service name.
describe.runIf(process.env.WASAP_KEYCHAIN_IT === '1')('Keychain (real)', () => {
  it('round-trips through /usr/bin/security', async () => {
    const kc = new Keychain(undefined, 'wasap-test');
    await kc.set('it', 'v1+/=');
    expect(await kc.get('it')).toBe('v1+/=');
    await kc.delete('it');
    expect(await kc.get('it')).toBeNull();
  });
});
