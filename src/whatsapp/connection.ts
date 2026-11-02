import type { ConnectionState } from './types.js';

/// How long a socket must stay open before the backoff resets. Without it, a
/// connection that opens and drops right away would retry every ~2s forever.
export const STABLE_OPEN_MS = 60_000;

export interface ReconnectOptions {
  connect: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  /** Delay for a 0-based attempt. Retry-class closes never give up. */
  delay: (attempt: number) => number;
  onState: (s: ConnectionState) => void;
  /** Runs `fn` after `ms`; returns a cancel function. Injected so tests control time. */
  schedule: (fn: () => void, ms: number) => () => void;
}

/// Bounded reconnect policy, kept free of Baileys so it can be tested with fakes.
/// A `connect` that resolves only means a new socket was created; whether it
/// worked is learned later from `handleOpen` (success) or another `handleClose`.
export class ReconnectController {
  private attempt = 0;
  private inFlight = false;
  private terminal = false;
  private cancelReset: (() => void) | null = null;

  constructor(private readonly o: ReconnectOptions) {}

  /// `terminal` is for closes where retrying is unsafe or pointless (see
  /// `classifyClose` in events.ts); it reports `gave_up` without a single retry.
  /// That is the only way to `gave_up`: other closes retry forever (capped delay).
  async handleClose(reason: 'logged_out' | 'terminal' | 'other'): Promise<void> {
    // The socket didn't stay up long enough to count as recovered.
    this.cancelStableReset();
    if (this.terminal) return;
    if (reason === 'logged_out' || reason === 'terminal') {
      // logged_out: the phone removed this device; reconnecting would only fail or re-pair.
      this.terminal = true;
      this.o.onState(reason === 'logged_out' ? 'logged_out' : 'gave_up');
      return;
    }
    // Baileys can emit more than one close for a dying socket; one reconnect is enough.
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await this.reconnectLoop();
    } finally {
      this.inFlight = false;
    }
  }

  /// Resets the backoff only once the socket has stayed open for STABLE_OPEN_MS.
  handleOpen(): void {
    this.cancelStableReset();
    this.cancelReset = this.o.schedule(() => {
      this.cancelReset = null;
      this.attempt = 0;
    }, STABLE_OPEN_MS);
  }

  /// Permanently disables reconnects (daemon shutdown). A sleeping attempt is dropped.
  stop(): void {
    this.terminal = true;
    this.cancelStableReset();
  }

  private cancelStableReset(): void {
    this.cancelReset?.();
    this.cancelReset = null;
  }

  private async reconnectLoop(): Promise<void> {
    for (;;) {
      const ms = this.o.delay(this.attempt);
      this.o.onState('reconnecting');
      await this.o.sleep(ms);
      if (this.terminal) return;
      this.attempt++;
      try {
        await this.o.connect();
        return;
      } catch {
        // Socket creation failed outright (no close event will follow), so retry here.
      }
    }
  }
}
