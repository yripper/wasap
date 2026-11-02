import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
} from '@whiskeysockets/baileys';
import type { SessionCrypto } from './session-crypto.js';

const CREDS_KEY = 'creds.json';

/// Signal ids can contain JIDs (@, :) or base64 (+, =, /); none are filesystem-safe.
function keyName(type: string, id: string): string {
  return `${type}-${id}`.replace(/[^A-Za-z0-9._-]/g, '_');
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

/// One AES-GCM-encrypted file per key. A wrong key makes decrypt throw, which
/// callers must treat as "cannot open session" rather than start from blank creds.
export async function useEncryptedAuthState(
  dir: string,
  crypto: SessionCrypto,
): Promise<{ state: AuthenticationState; saveCreds(): Promise<void>; clear(): Promise<void> }> {
  await mkdir(dir, { recursive: true, mode: 0o700 });

  async function read(name: string): Promise<Buffer | null> {
    try {
      return crypto.decrypt(await readFile(path.join(dir, name)));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async function write(name: string, data: Buffer): Promise<void> {
    const target = path.join(dir, name);
    // Write-then-rename so a crash mid-write can't leave a truncated, undecryptable file.
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, crypto.encrypt(data), { mode: 0o600 });
    await rename(tmp, target);
  }

  async function remove(name: string): Promise<void> {
    await rm(path.join(dir, name), { force: true });
  }

  const credsBuf = await read(CREDS_KEY);
  const creds: AuthenticationCreds = credsBuf ? (JSON.parse(credsBuf.toString('utf8'), BufferJSON.reviver) as AuthenticationCreds) : initAuthCreds();

  const keys: SignalKeyStore = {
    get: async (type, ids) => {
      const out: { [id: string]: SignalDataTypeMap[typeof type] } = {};
      await Promise.all(
        ids.map(async (id) => {
          const buf = await read(keyName(type, id));
          if (!buf) return;
          let value: unknown = JSON.parse(buf.toString('utf8'), BufferJSON.reviver);
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>);
          }
          out[id] = value as SignalDataTypeMap[typeof type];
        }),
      );
      return out;
    },
    set: async (data: SignalDataSet) => {
      const tasks: Promise<void>[] = [];
      for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
        const entries = data[category];
        if (!entries) continue;
        for (const [id, value] of Object.entries(entries)) {
          const name = keyName(category, id);
          tasks.push(value ? write(name, Buffer.from(JSON.stringify(value, BufferJSON.replacer), 'utf8')) : remove(name));
        }
      }
      await Promise.all(tasks);
    },
  };

  return {
    state: { creds, keys },
    saveCreds: () => write(CREDS_KEY, Buffer.from(JSON.stringify(creds, BufferJSON.replacer), 'utf8')),
    clear: async () => {
      for (const name of await readdir(dir)) await remove(name);
    },
  };
}
