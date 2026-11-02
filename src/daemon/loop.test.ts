import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startNonOverlappingLoop } from './loop.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startNonOverlappingLoop', () => {
  it('never overlaps a slow run', async () => {
    let running = 0;
    let maxConcurrent = 0;
    const task = async (): Promise<void> => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 2500));
      running--;
    };
    const stop = startNonOverlappingLoop(task, 1000, () => {});
    await vi.advanceTimersByTimeAsync(6000);
    stop();
    expect(maxConcurrent).toBe(1);
  });

  it('keeps running after a task error', async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const stop = startNonOverlappingLoop(
      async () => {
        calls++;
        throw new Error('boom');
      },
      1000,
      (e) => errors.push(e),
    );
    await vi.advanceTimersByTimeAsync(3500);
    stop();
    expect(calls).toBe(3);
    expect(errors).toHaveLength(3);
  });

  it('runs immediately and a slow first run blocks the next ticks', async () => {
    let calls = 0;
    let running = 0;
    let maxConcurrent = 0;
    const task = async (): Promise<void> => {
      calls++;
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 2500));
      running--;
    };
    const stop = startNonOverlappingLoop(task, 1000, () => {}, { immediate: true });
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(1); // ticks at 1s and 2s skipped
    await vi.advanceTimersByTimeAsync(1000); // first run ends at 2.5s, tick at 3s runs
    expect(calls).toBe(2);
    stop();
    expect(maxConcurrent).toBe(1);
  });
});
