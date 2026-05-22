/**
 * Tiny LRU cache backed by an insertion-ordered Map.
 *
 * - `get` and `set` both promote the entry to most-recently-used.
 * - When capacity is exceeded, the least-recently-used entry is evicted
 *   (i.e. the first key returned by Map iteration).
 *
 * Designed for small caches (~16 entries) used by HTTP clients to dedupe
 * recent requests, so we keep the implementation simple and allocation-free
 * on the hot path.
 */
export class LRUCache<K, V> {
  private readonly store: Map<K, V> = new Map();
  private readonly capacity: number;

  constructor(capacity: number) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(`LRUCache: capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = Math.floor(capacity);
  }

  get(key: K): V | undefined {
    if (!this.store.has(key)) return undefined;
    // We just checked .has(), but the Map API still returns V|undefined.
    // We narrow via a local binding to keep `noUncheckedIndexedAccess` happy.
    const value = this.store.get(key) as V;
    // Re-insert to mark as most-recently-used.
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.capacity) {
      // Evict the oldest entry (first inserted that has not been promoted).
      const oldest = this.store.keys().next();
      if (!oldest.done) {
        this.store.delete(oldest.value);
      }
    }
    this.store.set(key, value);
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
