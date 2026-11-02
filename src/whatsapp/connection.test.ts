import { describe, expect, it } from 'vitest';
import { ReconnectController } from './connection.js';
import type { ConnectionState } from './types.js';

function setup(opts: { delays?: (number | null)[]; failConnects?: number } = {}) {
  const delays = opts.delays ?? [10, 20, 40, null];
  let failures = opts.failConnects ?? 0;
  const log = {
    connects: 0,
    sleeps: [] as number[],
    delayCalls: [] as number[],
    states: [] as ConnectionState[],
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
      return delays[attempt] ?? null;
    },
    onState: (s: ConnectionState) => {
      log.states.push(s);
    },
  });
  return { controller, log };
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

  it('gives up once delay returns null and stops reconnecting', async () => {
    const { controller, log } = setup({ delays: [10, null] });
    await controller.handleClose('other');
    await controller.handleClose('other');
    expect(log.connects).toBe(1);
    expect(log.states).toEqual(['reconnecting', 'gave_up']);
    await controller.handleClose('other');
    expect(log.connects).toBe(1);
    expect(log.states).toEqual(['reconnecting', 'gave_up']);
  });

  it('keeps retrying with the next delay when connect itself throws', async () => {
    const { controller, log } = setup({ failConnects: 2 });
    await controller.handleClose('other');
    expect(log.delayCalls).toEqual([0, 1, 2]);
    expect(log.sleeps).toEqual([10, 20, 40]);
    expect(log.connects).toBe(3);
  });

  it('gives up when connect keeps throwing until delays run out', async () => {
    const { controller, log } = setup({ delays: [10, 20, null], failConnects: 5 });
    await controller.handleClose('other');
    expect(log.connects).toBe(2);
    expect(log.states.at(-1)).toBe('gave_up');
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

  it('handleOpen resets the attempt counter', async () => {
    const { controller, log } = setup();
    await controller.handleClose('other');
    await controller.handleClose('other');
    controller.handleOpen();
    await controller.handleClose('other');
    expect(log.delayCalls).toEqual([0, 1, 0]);
    expect(log.sleeps).toEqual([10, 20, 10]);
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
