import type { Logger } from '../daemon/logger.js';

/// Structural copy of Baileys' ILogger (Utils/logger.d.ts), which its index does not export.
export interface BaileysLogger {
  level: string;
  child(obj: Record<string, unknown>): BaileysLogger;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

// JIDs (user@server, with optional :device) and digit runs long enough to be a phone number or LID user.
const JID = /[^\s,;:'"()<>[\]=]*@[^\s,;'"()<>[\]=]+/g;
const LONG_NUMBER = /\d{5,}/g;

function scrub(msg: string): string {
  return msg.replace(JID, '[jid]').replace(LONG_NUMBER, '[num]');
}

function errName(obj: unknown): string | undefined {
  if (obj === null || typeof obj !== 'object') return undefined;
  const err = (obj as { err?: unknown; error?: unknown }).err ?? (obj as { error?: unknown }).error;
  return err instanceof Error ? err.name : undefined;
}

/// Baileys' warn/error calls put JIDs, push names and whole decoded stanzas
/// (binaryNodeToString) in the merge object, and sometimes JIDs in the message.
/// So only warn and error get through, the merge object is dropped (keeping just
/// an error's class name), and JIDs and long numbers are masked in the message.
/// What's left (level + a fixed-text reason) still says what went wrong.
export function quietBaileysLogger(parent: Logger): BaileysLogger {
  const out = parent.child({ module: 'baileys' });
  const forward = (level: 'warn' | 'error') => (obj: unknown, msg?: string): void => {
    const text = typeof obj === 'string' ? obj : (msg ?? '');
    const name = errName(obj);
    out[level](name ? { errName: name } : {}, scrub(text));
  };
  const drop = (): void => undefined;
  const logger: BaileysLogger = {
    level: 'warn',
    // Baileys' child bindings carry JIDs too; children share the same scrubbing.
    child: () => logger,
    trace: drop,
    debug: drop,
    info: drop,
    warn: forward('warn'),
    error: forward('error'),
  };
  return logger;
}
