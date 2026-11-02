import { describe, expect, it } from 'vitest';
import { ReconnectController, STABLE_OPEN_MS } from './connection.js';
import type { ConnectionState } from './types.js';

interface Timer {
  ms: number;
  fn: () => void;
  cancelled: boolean;
}

function setup(opts: { delays?: number[]; failConnects?: number } = {}) {
  const delays = opts.delays ?? [10, 20, 40, 80];
  let failures = opts.failConnects ?? 0;
  const log = {
    connects: 0,
    sleeps: [] as number[],
    delayCalls: [] as number[],
    states: [] as ConnectionState[],
    timers: [] as Timer[],
  };
  const controller = new ReconnectController({
    connect: async () => {
      log.connects++;
      if (failures > 0) {
        failures--;
        throw new Error('connect failed');
      }
    },
    sleep: async (ms: number) => {
      log.sleeps.push(ms);
    },
    delay: (attempt: number) => {
      log.delayCalls.push(attempt);
      return delays[attempt] ?? 999;
    },
    onState: (s: ConnectionState) => {
      log.states.push(s);
    },
    schedule: (fn: () => void, ms: number) => {
      const t: Timer = { ms, fn, cancelled: false };
      log.timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
  });
  const fireTimers = (): void => {
    for (const t of log.timers) if (!t.cancelled) t.fn();
  };
  return { controller, log, fireTimers };
}

describe('ReconnectController', () => {
  it('reconnects after the delay for the current attempt and reports reconnecting', async () => {
    const { controller, log } = setup();
    await controller.handleClose('other');
    expect(log.delayCalls).toEqual([0]);
    expect(log.sleeps).toEqual([10]);
    expect(log.connects).toBe(1);
    expect(log.states).toEqual(['reconnecting']);
  });

  it('uses growing attempts on repeated closes', async () => {
    const { controller, log } = setup();
    await controller.handleClose('other');
    await controller.handleClose('other');
    await controller.handleClose('other');
    expect(log.delayCalls).toEqual([0, 1, 2]);
    expect(log.sleeps).toEqual([10, 20, 40]);
    expect(log.connects).toBe(3);
  });

  it('never gives up on retry-class closes: past the schedule it keeps retrying', async () => {
    const { controller, log } = setup({ delays: [10, 20] });
    for (let i = 0; i < 5; i++) await controller.handleClose('other');
    expect(log.connects).toBe(5);
    expect(log.sleeps).toEqual([10, 20, 999, 999, 999]);
    expect(log.states).not.toContain('gave_up');
  });

  it('keeps retrying when connect keeps throwing', async () => {
    const { controller, log } = setup({ delays: [10, 20], failConnects: 4 });
    await controller.handleClose('other');
    expect(log.connects).toBe(5);
    expect(log.states).not.toContain('gave_up');
  });

  it('on logged_out reports logged_out and never connects', async () => {
    const { controller, log } = setup();
    await controller.handleClose('logged_out');
    expect(log.states).toEqual(['logged_out']);
    expect(log.connects).toBe(0);
    expect(log.sleeps).toEqual([]);
    await controller.handleClose('other');
    expect(log.connects).toBe(0);
  });

  it('on terminal reports gave_up, never connects and stays stopped', async () => {
    const { controller, log } = setup();
    await controller.handleClose('terminal');
    expect(log.states).toEqual(['gave_up']);
    expect(log.connects).toBe(0);
    expect(log.sleeps).toEqual([]);
    await controller.handleClose('other');
    expect(log.connects).toBe(0);
  });

  it('resets the attempt counter only after the socket stays open for the stable period', async () => {
    const { controller, log, fireTimers } = setup();
    await controller.handleClose('other');
    await controller.handleClose('other');
    controller.handleOpen();
    expect(log.timers.map((t) => t.ms)).toEqual([STABLE_OPEN_MS]);
    fireTimers();
    await controller.handleClose('other');
    expect(log.delayCalls).toEqual([0, 1, 0]);
    expect(log.sleeps).toEqual([10, 20, 10]);
  });

  it('open-then-close flapping keeps backing off instead of resetting', async () => {
    const { controller, log, fireTimers } = setup();
    for (let i = 0; i < 4; i++) {
      await controller.handleClose('other');
      controller.handleOpen();
    }
    await controller.handleClose('other');
    // The pending reset timers were cancelled by each close, so firing them does nothing.
    expect(log.timers.every((t) => t.cancelled)).toBe(true);
    fireTimers();
    await controller.handleClose('other');
    expect(log.delayCalls).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('stop() cancels a pending stable-open reset', () => {
    const { controller, log } = setup();
    controller.handleOpen();
    controller.stop();
    expect(log.timers[0]?.cancelled).toBe(true);
  });

  it('ignores a close that arrives while a reconnect is already in flight', async () => {
    let release: () => void = () => undefined;
    const states: ConnectionState[] = [];
    let connects = 0;
    const controller = new ReconnectController({
      connect: async () => {
        connects++;
      },
      sleep: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      delay: () => 5,
      onState: (s: ConnectionState) => states.push(s),
      schedule: () => () => undefined,
    });
    const first = controller.handleClose('other');
    await controller.handleClose('other');
    release();
    await first;
    expect(connects).toBe(1);
  });

  it('stop() prevents any further reconnect, including one already sleeping', async () => {
    let release: () => void = () => undefined;
    let connects = 0;
    const controller = new ReconnectController({
      connect: async () => {
        connects++;
      },
      sleep: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      delay: () => 5,
      onState: () => undefined,
      schedule: () => () => undefined,
    });
    const pending = controller.handleClose('other');
    controller.stop();
    release();
    await pending;
    expect(connects).toBe(0);
    await controller.handleClose('other');
    expect(connects).toBe(0);
  });
});
