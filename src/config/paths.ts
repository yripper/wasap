import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AppPaths {
  home: string;
  config: string;
  db: string;
  authDir: string;
  lock: string;
  style: string;
}

/// Every on-disk location derives from one root so backing up ~/.wasap
/// backs up everything.
export function resolvePaths(env: NodeJS.ProcessEnv = process.env): AppPaths {
  const home = env.WASAP_HOME ?? join(homedir(), '.wasap');
  return {
    home,
    config: join(home, 'config.json'),
    db: join(home, 'wasap.db'),
    authDir: join(home, 'auth'),
    lock: join(home, 'wasap.lock'),
    style: join(home, 'style.md'),
  };
}

/// 0700 because the directory holds the message store and the WhatsApp auth
/// state. chmod after mkdir: `mode` is ignored when the directory already exists.
export function ensureHome(paths: AppPaths): void {
  mkdirSync(paths.home, { recursive: true, mode: 0o700 });
  chmodSync(paths.home, 0o700);
  mkdirSync(paths.authDir, { recursive: true, mode: 0o700 });
  chmodSync(paths.authDir, 0o700);
}
