/** Classic token bucket. `rate` tokens per second, up to `burst`. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly rate: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
    this.last = performance.now();
  }

  take(n = 1): boolean {
    const now = performance.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }

  get idleFull(): boolean {
    const now = performance.now();
    return this.tokens + ((now - this.last) / 1000) * this.rate >= this.burst;
  }
}

/** Per-key buckets with periodic cleanup so the map can't grow without bound. */
export class KeyedLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly maxKeys = 10_000,
  ) {}

  take(key: string): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.sweep();
      if (this.buckets.size >= this.maxKeys) return false;
      b = new TokenBucket(this.rate, this.burst);
      this.buckets.set(key, b);
    }
    return b.take();
  }

  sweep(): void {
    for (const [k, b] of this.buckets) if (b.idleFull) this.buckets.delete(k);
  }
}
