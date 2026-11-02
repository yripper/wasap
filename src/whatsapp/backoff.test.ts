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
  it('keeps retrying at capMs after maxAttempts instead of giving up', () => {
    expect(nextDelayMs(BACKOFF.maxAttempts, () => 0.5)).toBe(BACKOFF.capMs);
    expect(nextDelayMs(1000, () => 0.5)).toBe(BACKOFF.capMs);
  });
});
