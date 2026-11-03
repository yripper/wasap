import { describe, expect, it } from 'vitest';
import { PerKeyGap, RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  it('allows up to max hits per window, then reports how long to wait', () => {
    let t = 0;
    const l = new RateLimiter(2, 60_000, () => t);
    expect(l.tryAcquire()).toEqual({ ok: true });
    t = 10_000;
    expect(l.tryAcquire()).toEqual({ ok: true });
    t = 20_000;
    expect(l.tryAcquire()).toEqual({ ok: false, retryAfterMs: 40_000 });
  });

  it('frees slots as the window slides', () => {
    let t = 0;
    const l = new RateLimiter(1, 1000, () => t);
    l.tryAcquire();
    t = 1000;
    expect(l.tryAcquire()).toEqual({ ok: true });
  });

  it('does not record rejected attempts', () => {
    let t = 0;
    const l = new RateLimiter(1, 1000, () => t);
    l.tryAcquire();
    t = 500;
    l.tryAcquire();
    t = 1000;
    expect(l.tryAcquire().ok).toBe(true);
  });
});

describe('PerKeyGap', () => {
  it('enforces a minimum gap per key, independently across keys', () => {
    let t = 0;
    const g = new PerKeyGap(1000, () => t);
    expect(g.tryAcquire('111@s.whatsapp.net').ok).toBe(true);
    expect(g.tryAcquire('222@lid').ok).toBe(true);
    t = 400;
    expect(g.tryAcquire('111@s.whatsapp.net')).toEqual({ ok: false, retryAfterMs: 600 });
    t = 1000;
    expect(g.tryAcquire('111@s.whatsapp.net').ok).toBe(true);
  });
});
