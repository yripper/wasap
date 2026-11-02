import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireLock } from './lock.js';

const lockPath = (): string => join(mkdtempSync(join(tmpdir(), 'wasap-lock-')), 'wasap.lock');

describe('acquireLock', () => {
  it('writes the pid and releases cleanly', () => {
    const path = lockPath();
    const lock = acquireLock(path);
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
    lock.release();
    expect(existsSync(path)).toBe(false);
  });

  it('refuses when a live process holds the lock', () => {
    const path = lockPath();
    acquireLock(path, process.pid);
    expect(() => acquireLock(path, 4242)).toThrowError(/already running/);
  });

  it('takes over a stale lock left by a crash', () => {
    const path = lockPath();
    writeFileSync(path, '99999999');
    acquireLock(path);
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
  });

  it.each(['', 'garbage', '0'])('takes over a lock file containing %j', (content) => {
    const path = lockPath();
    writeFileSync(path, content);
    acquireLock(path);
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
  });
});
