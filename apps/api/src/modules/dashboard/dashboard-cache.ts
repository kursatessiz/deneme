/**
 * A small in-memory TTL cache for computed overview cards. Values are the
 * pending promises themselves, so identical cards requested at the same
 * time share one computation; a rejected promise is dropped at once so an
 * error is never cached. Bounded: the oldest entries go first once
 * `maxEntries` is reached. Per API process (no cross-instance sharing).
 */
export class TtlPromiseCache<T> {
  private readonly entries = new Map<string, { expiresAt: number; value: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  getOrCreate(key: string, factory: () => Promise<T>): Promise<T> {
    const current = this.now();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > current) return hit.value;
    if (hit) this.entries.delete(key);

    const value = factory();
    this.entries.set(key, { expiresAt: current + this.ttlMs, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    this.evict(current);
    return value;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private evict(current: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= current) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}
