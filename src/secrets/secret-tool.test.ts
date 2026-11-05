import { describe, expect, it } from 'vitest';
import { AppError } from '../domain/errors.js';
import { type CommandRunner, spawnRunner } from './keychain.js';
import { SecretTool } from './secret-tool.js';

type Result = { code: number; stdout: string; stderr: string };

class FakeRunner implements CommandRunner {
  readonly calls: { args: string[]; stdin?: string }[] = [];
  constructor(private readonly result: Result | Error) {}
  async run(args: string[], stdin?: string): Promise<Result> {
    this.calls.push({ args, stdin });
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

const ok = (stdout = ''): FakeRunner => new FakeRunner({ code: 0, stdout, stderr: '' });
const enoent = (): Error => Object.assign(new Error('spawn secret-tool ENOENT'), { code: 'ENOENT' });

describe('SecretTool', () => {
  it('get looks the secret up by service and account', async () => {
    const runner = ok('s3cr3t');
    expect(await new SecretTool(runner).get('auth_key')).toBe('s3cr3t');
    expect(runner.calls[0]?.args).toEqual(['lookup', 'service', 'wasap', 'account', 'auth_key']);
  });

  it('get strips a trailing newline', async () => {
    expect(await new SecretTool(ok('s3cr3t\n')).get('auth_key')).toBe('s3cr3t');
  });

  it('get returns null when secret-tool exits 1 with no output', async () => {
    expect(await new SecretTool(new FakeRunner({ code: 1, stdout: '', stderr: '' })).get('x')).toBeNull();
  });

  it('get returns null on exit 0 with empty output', async () => {
    expect(await new SecretTool(ok('')).get('x')).toBeNull();
  });

  it('get throws INTERNAL with the stderr reason when the keyring is unreachable', async () => {
    const runner = new FakeRunner({ code: 1, stdout: '', stderr: 'secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY\n' });
    await expect(new SecretTool(runner).get('x')).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringContaining('Cannot autolaunch D-Bus'),
    });
  });

  it('set sends the secret on stdin, never argv', async () => {
    const runner = ok();
    await new SecretTool(runner).set('auth_key', 'abc+/=123');
    expect(runner.calls[0]?.args).toEqual(['store', '--label=wasap auth_key', 'service', 'wasap', 'account', 'auth_key']);
    expect(runner.calls[0]?.stdin).toBe('abc+/=123');
    expect(runner.calls[0]?.args.join(' ')).not.toContain('abc+/=123');
  });

  it('set uses the configured service name', async () => {
    const runner = ok();
    await new SecretTool(runner, 'wasap-test').set('it', 'v');
    expect(runner.calls[0]?.args).toEqual(['store', '--label=wasap-test it', 'service', 'wasap-test', 'account', 'it']);
  });

  it('set rejects values outside the shared safe charset, same as the Keychain backend', async () => {
    const runner = ok();
    await expect(new SecretTool(runner).set('auth_key', 'a b')).rejects.toBeInstanceOf(AppError);
    await expect(new SecretTool(runner).set('auth_key', 'a\nb')).rejects.toBeInstanceOf(AppError);
    await expect(new SecretTool(runner).set('bad account', 'v')).rejects.toBeInstanceOf(AppError);
    expect(runner.calls).toHaveLength(0);
  });

  it('set throws INTERNAL without echoing the value when secret-tool fails', async () => {
    const runner = new FakeRunner({ code: 1, stdout: '', stderr: 'boom' });
    const err = await new SecretTool(runner).set('auth_key', 'topsecretvalue').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'INTERNAL' });
    expect((err as Error).message).not.toContain('topsecretvalue');
  });

  it('delete clears by service and account', async () => {
    const runner = ok();
    await new SecretTool(runner).delete('auth_key');
    expect(runner.calls[0]?.args).toEqual(['clear', 'service', 'wasap', 'account', 'auth_key']);
  });

  it('delete treats a missing item (exit 1, no stderr) as success', async () => {
    await expect(new SecretTool(new FakeRunner({ code: 1, stdout: '', stderr: '' })).delete('x')).resolves.toBeUndefined();
  });

  it('delete throws INTERNAL when the keyring reports an error', async () => {
    await expect(new SecretTool(new FakeRunner({ code: 1, stdout: '', stderr: 'locked' })).delete('x')).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });

  it('explains how to install secret-tool when the binary is missing', async () => {
    for (const op of [(s: SecretTool) => s.get('x'), (s: SecretTool) => s.set('x', 'v'), (s: SecretTool) => s.delete('x')]) {
      await expect(op(new SecretTool(new FakeRunner(enoent())))).rejects.toMatchObject({
        code: 'INTERNAL',
        message: expect.stringContaining('sudo apt install libsecret-tools'),
      });
    }
  });

  it('rethrows other spawn failures unchanged', async () => {
    const boom = new Error('EACCES');
    await expect(new SecretTool(new FakeRunner(boom)).get('x')).rejects.toBe(boom);
  });
});

// Opt-in: touches the real keyring under a throwaway service name.
describe.runIf(process.env.WASAP_SECRET_TOOL_IT === '1')('SecretTool (real)', () => {
  it('round-trips through secret-tool', async () => {
    const st = new SecretTool(undefined, 'wasap-test');
    await st.set('it', 'v1+/=');
    expect(await st.get('it')).toBe('v1+/=');
    await st.delete('it');
    expect(await st.get('it')).toBeNull();
  });
});

describe('SecretTool with a real spawn of a missing binary', () => {
  it('turns ENOENT into the install hint', async () => {
    await expect(new SecretTool(spawnRunner('wasap-no-such-secret-tool')).get('x')).rejects.toMatchObject({
      message: expect.stringContaining('libsecret-tools'),
    });
  });
});
