import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('omits hostname and pid, and redacts text', () => {
    const lines: string[] = [];
    const log = createLogger({ write: (s: string) => void lines.push(s) });
    log.info({ text: 'secret body' }, 'hello');
    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry).not.toHaveProperty('hostname');
    expect(entry).not.toHaveProperty('pid');
    expect(entry).toMatchObject({ msg: 'hello', text: '[redacted]' });
  });
});
