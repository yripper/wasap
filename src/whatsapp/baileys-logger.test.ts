import { Writable } from 'node:stream';
import { pino } from 'pino';
import type { Logger } from '../daemon/logger.js';
import { describe, expect, it } from 'vitest';
import { quietBaileysLogger } from './baileys-logger.js';

function capture(level = 'info'): { lines: () => Record<string, unknown>[]; parent: Logger } {
  const chunks: string[] = [];
  const dest = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  const parent = pino({ level }, dest);
  return { parent, lines: () => chunks.join('').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) };
}

describe('quietBaileysLogger', () => {
  it('drops the merge object and scrubs JIDs and long digit runs from the message', () => {
    const { parent, lines } = capture();
    const log = quietBaileysLogger(parent);
    log.warn({ node: '<message from="111@s.whatsapp.net" notify="Someone">hello</message>' }, 'Invalid LID-PN mapping: 222@lid, 111@s.whatsapp.net');
    log.warn('Invalid entry for 5551234567 (pair not resolved)');
    const out = JSON.stringify(lines());
    expect(out).not.toContain('111');
    expect(out).not.toContain('222');
    expect(out).not.toContain('5551234567');
    expect(out).not.toContain('Someone');
    expect(out).not.toContain('hello');
    expect(out).not.toContain('node');
    expect(lines()[0]).toMatchObject({ level: 40, module: 'baileys', msg: 'Invalid LID-PN mapping: [jid], [jid]' });
    expect(lines()[1]?.msg).toBe('Invalid entry for [num] (pair not resolved)');
  });

  it('keeps the error class name as a signal but never the error message', () => {
    const { parent, lines } = capture();
    quietBaileysLogger(parent).error({ err: new TypeError('bad 111@s.whatsapp.net') }, 'failed to decrypt message');
    expect(lines()[0]).toMatchObject({ level: 50, msg: 'failed to decrypt message', errName: 'TypeError' });
    expect(JSON.stringify(lines())).not.toContain('111');
  });

  it('drops trace, debug and info entirely, and children behave the same', () => {
    const { parent, lines } = capture('trace');
    const log = quietBaileysLogger(parent);
    expect(log.level).toBe('warn');
    log.trace({ msg: 'x' }, 'trace');
    log.debug({}, 'debug');
    log.info({}, 'info');
    const child = log.child({ class: '111@s.whatsapp.net' });
    child.info({}, 'child info');
    child.warn({ jid: '111@s.whatsapp.net' }, 'child warn');
    expect(lines().map((l) => l.msg)).toEqual(['child warn']);
    expect(JSON.stringify(lines())).not.toContain('111');
  });

  it('respects a quieter parent', () => {
    const { parent, lines } = capture('silent');
    quietBaileysLogger(parent).error({}, 'boom');
    expect(lines()).toEqual([]);
  });
});
