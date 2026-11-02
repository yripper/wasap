import type { ConnectionState } from './types.js';

export interface ReconnectOptions {
  connect: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  /** Delay for a 0-based attempt; null means give up. */
  delay: (attempt: number) => number | null;
  onState: (s: ConnectionState) => void;
}

/// Bounded reconnect policy, kept free of Baileys so it can be tested with fakes.
/// A `connect` that resolves only means a new socket was created; whether it
/// worked is learned later from `handleOpen` (success) or another `handleClose`.
export class ReconnectController {
  private attempt = 0;
  private inFlight = false;
  private terminal = false;

  constructor(private readonly o: ReconnectOptions) {}

  async handleClose(reason: 'logged_out' | 'other'): Promise<void> {
    if (this.terminal) return;
    if (reason === 'logged_out') {
      // The phone removed this device; reconnecting would only fail or re-pair.
      this.terminal = true;
      this.o.onState('logged_out');
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

  handleOpen(): void {
    this.attempt = 0;
  }

  /// Permanently disables reconnects (daemon shutdown). A sleeping attempt is dropped.
  stop(): void {
    this.terminal = true;
  }

  private async reconnectLoop(): Promise<void> {
    for (;;) {
      const ms = this.o.delay(this.attempt);
      if (ms === null) {
        this.terminal = true;
        this.o.onState('gave_up');
        return;
      }
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
