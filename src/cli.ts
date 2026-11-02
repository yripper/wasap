#!/usr/bin/env node
import { stdout } from 'node:process';
import { loadConfig } from './config/config.js';
import { type AppPaths, ensureHome, resolvePaths } from './config/paths.js';
import { describeError } from './domain/errors.js';
import { exitOnSignals, startDaemon } from './daemon/daemon.js';
import { acquireLock } from './daemon/lock.js';
import { createLogger } from './daemon/logger.js';
import { connectionSnippets } from './daemon/snippets.js';
import { ensureBearerToken } from './daemon/token.js';
import { Keychain } from './secrets/keychain.js';
import { BaileysGateway } from './whatsapp/gateway.js';
import { clearLink, isLinked, runLogin, runLogout } from './whatsapp/login.js';
import { loadOrCreateAuthKey } from './whatsapp/session-crypto.js';

const USAGE = `usage: wasap <command>
  login [--force]  link this computer to WhatsApp by scanning a QR code (--force replaces an existing link)
  start            run the daemon (what pm2 runs)
  token            print the Claude Code / Claude Desktop connection setup
  logout           unlink this device from WhatsApp and delete the local session (keeps the message store)`;

/// login and logout take the daemon's lock: two sockets on one session make
/// WhatsApp replace one of them, so they refuse while the daemon is running.
async function withLock(paths: AppPaths, fn: () => Promise<void>): Promise<void> {
  ensureHome(paths);
  const lock = acquireLock(paths.lock);
  try {
    await fn();
  } finally {
    lock.release();
  }
}

async function login(force: boolean): Promise<void> {
  const paths = resolvePaths();
  await withLock(paths, async () => {
    const keychain = new Keychain();
    const crypto = await loadOrCreateAuthKey(keychain);
    if (await isLinked(paths.authDir, crypto)) {
      if (!force) {
        stdout.write('Already linked. Run `wasap login --force` to replace the link, or `wasap logout` first.\n');
        process.exitCode = 1;
        return;
      }
      await clearLink(paths.authDir, crypto);
    }
    stdout.write('Open WhatsApp on your phone > Settings > Linked devices > Link a device, and scan:\n');
    await runLogin({ authDir: paths.authDir, crypto, print: (s: string) => stdout.write(`${s}\n`) });
    await ensureBearerToken(keychain);
    stdout.write('Linked. Next: `pnpm build && pm2 start ecosystem.config.cjs` (later: `pm2 restart wasap`), then `wasap token`.\n');
  });
}

async function start(): Promise<void> {
  const log = createLogger();
  const paths = resolvePaths();
  ensureHome(paths);
  const keychain = new Keychain();
  // Log-only safety net: a stray rejection must not take the daemon down, and
  // describeError never includes message text or secrets.
  process.on('unhandledRejection', (e: unknown) => log.error(`unhandled rejection: ${describeError(e)}`));
  const daemon = await startDaemon({
    paths,
    config: loadConfig(paths.config),
    secrets: keychain,
    logger: log,
    gatewayFactory: async ({ getMessageText }) =>
      BaileysGateway.start({ authDir: paths.authDir, crypto: await loadOrCreateAuthKey(keychain), getMessageText, logger: log }),
  });
  exitOnSignals(daemon, log);
}

async function token(): Promise<void> {
  const paths = resolvePaths();
  const value = await ensureBearerToken(new Keychain());
  stdout.write(`${connectionSnippets(loadConfig(paths.config).port, value)}\n`);
}

async function logout(): Promise<void> {
  const paths = resolvePaths();
  await withLock(paths, async () => {
    const crypto = await loadOrCreateAuthKey(new Keychain());
    const result = await runLogout({ authDir: paths.authDir, crypto });
    if (result === 'not_linked') stdout.write('Not linked; nothing to do.\n');
    if (result === 'remote') stdout.write('Logged out: this device was removed from your WhatsApp account.\n');
    if (result === 'local_only') {
      stdout.write('Could not reach WhatsApp, so only the local session was deleted. Remove this computer under Settings > Linked devices on your phone.\n');
    }
    stdout.write(`The message store is still in ${paths.home}; delete it to remove everything.\n`);
  });
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'login') return login(args.includes('--force'));
  if (command === 'start') return start();
  if (command === 'token') return token();
  if (command === 'logout') return logout();
  stdout.write(`${USAGE}\n`);
  process.exitCode = command ? 1 : 0;
}

main().catch((e: unknown) => {
  process.stderr.write(`${describeError(e)}\n`);
  process.exit(1);
});
