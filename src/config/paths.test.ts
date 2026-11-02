import { mkdtempSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureHome, resolvePaths } from './paths.js';

describe('resolvePaths', () => {
  it('defaults to ~/.wasap', () => {
    expect(resolvePaths({}).home).toBe(join(homedir(), '.wasap'));
  });

  it('honors WASAP_HOME and derives every file from it', () => {
    expect(resolvePaths({ WASAP_HOME: '/x/pp' })).toEqual({
      home: '/x/pp',
      config: '/x/pp/config.json',
      db: '/x/pp/wasap.db',
      authDir: '/x/pp/auth',
      lock: '/x/pp/wasap.lock',
      style: '/x/pp/style.md',
    });
  });
});

describe('ensureHome', () => {
  it('creates the directory with mode 0700', () => {
    const paths = resolvePaths({ WASAP_HOME: join(mkdtempSync(join(tmpdir(), 'wasap-')), 'home') });
    ensureHome(paths);
    expect(statSync(paths.home).mode & 0o777).toBe(0o700);
    expect(statSync(paths.authDir).mode & 0o777).toBe(0o700);
  });
});
