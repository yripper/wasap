import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configSchema } from '../config/config.js';
import { type AppPaths, ensureHome, resolvePaths } from '../config/paths.js';
import { AppError } from '../domain/errors.js';
import { SECRET_ACCOUNTS } from '../secrets/keychain.js';
import { FakeGateway } from '../testing/fake-gateway.js';
import { MemorySecretStore } from '../testing/memory-secrets.js';
import type { WhatsAppGateway } from '../whatsapp/types.js';
import { startDaemon } from './daemon.js';
import { acquireLock } from './lock.js';

const DM = '111@s.whatsapp.net';
const LID = '222@lid';

let home: string;
let paths: AppPaths;
let secrets: MemorySecretStore;
let running: { stop(): Promise<void> } | null;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'wasap-daemon-'));
  paths = resolvePaths({ WASAP_HOME: home });
  ensureHome(paths);
  secrets = new MemorySecretStore();
  running = null;
});

afterEach(async () => {
  await running?.stop();
  rmSync(home, { recursive: true, force: true });
});

// Port 0 is below the config schema's minimum, but startDaemon takes a parsed
// Config as-is, and an ephemeral port keeps parallel test runs from colliding.
const config = { ...configSchema.parse({}), port: 0 };

async function start(gatewayFactory: Parameters<typeof startDaemon>[0]['gatewayFactory']): Promise<{ stop(): Promise<void>; port: number }> {
  const d = await startDaemon({ paths, config, secrets, logger: pino({ level: 'silent' }), gatewayFactory });
  running = d;
  return d;
}

async function callTool(port: number, name: string): Promise<{ isError?: boolean; text: string }> {
  const token = await secrets.get(SECRET_ACCOUNTS.bearerToken);
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const r = (await client.callTool({ name, arguments: {} })) as { isError?: boolean; content: { type: string; text: string }[] };
    return { isError: r.isError, text: r.content[0]?.text ?? '' };
  } finally {
    await client.close();
  }
}

describe('startDaemon', () => {
  it('applies gateway events and reports them through status over HTTP', async () => {
    const gw = new FakeGateway();
    const d = await start(async () => gw);
    gw.emit({
      kind: 'messages',
      messages: [{ chatId: DM, waId: 'M1', fromMe: false, senderJid: null, ts: 1700000000, text: 'hello', mediaKind: null, quotedId: null, senderAltJid: null }],
    });

    const status = JSON.parse((await callTool(d.port, 'status')).text) as Record<string, unknown>;
    expect(status).toMatchObject({ connection: 'open', chats: 1, messages: 1 });
    expect(typeof status.lastEventAt).toBe('string');
  });

  it('releases the lock and stops the gateway on stop', async () => {
    const gw = new FakeGateway();
    const d = await start(async () => gw);
    expect(() => acquireLock(paths.lock, process.pid + 1_000_000)).toThrow();
    await d.stop();
    running = null;
    expect(gw.callsTo('stop')).toHaveLength(1);
    const second = acquireLock(paths.lock);
    second.release();
  });

  it('refuses to start while another live process holds the lock', async () => {
    const other = acquireLock(paths.lock, process.ppid);
    try {
      await expect(start(async () => new FakeGateway())).rejects.toThrow(/already running/);
    } finally {
      other.release();
    }
  });

  it('stays up and reports logged_out when WhatsApp is not linked', async () => {
    const d = await start(async () => {
      throw new AppError('AUTH_REQUIRED', 'not linked');
    });
    const status = JSON.parse((await callTool(d.port, 'status')).text) as Record<string, unknown>;
    expect(status).toMatchObject({ connection: 'logged_out', messages: 0, pending: 0 });
  });

  it('releases the lock when the gateway fails to start for another reason', async () => {
    await expect(
      start(async () => {
        throw new Error('bad auth key');
      }),
    ).rejects.toThrow('bad auth key');
    acquireLock(paths.lock, process.pid + 1_000_000).release();
  });

  it('passes an alias-resolving getMessageText to the gateway', async () => {
    const gw = new FakeGateway();
    const seen: { getMessageText?: (chatId: string, waId: string) => string | null } = {};
    const d = await start(async (o: { getMessageText: (chatId: string, waId: string) => string | null }): Promise<WhatsAppGateway> => {
      seen.getMessageText = o.getMessageText;
      return gw;
    });
    gw.emit({ kind: 'aliases', pairs: [{ lid: LID, pn: DM }] });
    gw.emit({
      kind: 'messages',
      messages: [{ chatId: DM, waId: 'M1', fromMe: true, senderJid: null, ts: 1700000000, text: 'hi', mediaKind: null, quotedId: null, senderAltJid: null }],
    });
    expect(d.port).toBeGreaterThan(0);
    expect(seen.getMessageText?.(LID, 'M1')).toBe('hi');
    expect(seen.getMessageText?.(DM, 'missing')).toBeNull();
  });
});
