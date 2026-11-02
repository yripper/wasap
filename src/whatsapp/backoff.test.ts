import { describe, expect, it } from 'vitest';
import { BACKOFF, nextDelayMs } from './backoff.js';

describe('nextDelayMs', () => {
  it('starts at the base delay', () => {
    expect(nextDelayMs(0, () => 0.5)).toBe(2000);
  });
  it('doubles per attempt', () => {
    expect(nextDelayMs(3, () => 0.5)).toBe(16000);
  });
  it('caps at capMs', () => {
    expect(nextDelayMs(9, () => 0.5)).toBe(BACKOFF.capMs);
  });
  it('applies ±20% jitter', () => {
    expect(nextDelayMs(0, () => 0)).toBe(1600);
    expect(nextDelayMs(0, () => 1)).toBe(2400);
  });
  it('gives up after maxAttempts', () => {
    expect(nextDelayMs(10)).toBeNull();
    expect(nextDelayMs(20)).toBeNull();
  });
});
