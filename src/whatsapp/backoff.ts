export const BACKOFF = { baseMs: 2000, factor: 2, capMs: 300000, maxAttempts: 10 } as const;

/// Reconnect delay for a 0-based attempt, with ±20% jitter. Past `maxAttempts`
/// it stays at `capMs` forever: a network outage must not leave the daemon dead
/// until someone restarts it. Only terminal closes stop retrying (connection.ts).
/// Jitter spreads retries so a flapping network doesn't hammer WhatsApp in lockstep.
export function nextDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = attempt >= BACKOFF.maxAttempts ? BACKOFF.capMs : Math.min(BACKOFF.baseMs * BACKOFF.factor ** attempt, BACKOFF.capMs);
  return Math.round(base * (0.8 + 0.4 * random()));
}
