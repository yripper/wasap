export type Acquire = { ok: true } | { ok: false; retryAfterMs: number };

/// Sliding window. Callers turn a rejection into RATE_LIMITED for Claude
/// instead of sleeping: a tool call that silently hangs is worse than a
/// clear "retry in N seconds".
export class RateLimiter {
  private hits: number[] = [];

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryAcquire(): Acquire {
    const t = this.now();
    this.hits = this.hits.filter((h) => t - h < this.windowMs);
    const oldest = this.hits[0];
    if (this.hits.length >= this.maxPerWindow && oldest !== undefined) {
      return { ok: false, retryAfterMs: this.windowMs - (t - oldest) };
    }
    this.hits.push(t);
    return { ok: true };
  }
}

export class PerKeyGap {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly gapMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryAcquire(key: string): Acquire {
    const t = this.now();
    const prev = this.last.get(key);
    if (prev !== undefined && t - prev < this.gapMs) return { ok: false, retryAfterMs: this.gapMs - (t - prev) };
    this.last.set(key, t);
    return { ok: true };
  }
}
