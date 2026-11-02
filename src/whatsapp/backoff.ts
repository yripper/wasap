export const BACKOFF = { baseMs: 2000, factor: 2, capMs: 300000, maxAttempts: 10 } as const;

/// Reconnect delay for a 0-based attempt, with ±20% jitter; null once attempts are exhausted.
/// Jitter spreads retries so a flapping network doesn't hammer WhatsApp in lockstep.
export function nextDelayMs(attempt: number, random: () => number = Math.random): number | null {
  if (attempt >= BACKOFF.maxAttempts) return null;
  const base = Math.min(BACKOFF.baseMs * BACKOFF.factor ** attempt, BACKOFF.capMs);
  return Math.round(base * (0.8 + 0.4 * random()));
}
