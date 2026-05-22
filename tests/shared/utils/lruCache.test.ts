import { LRUCache } from '../../../src/shared/utils/lruCache';

describe('LRUCache', () => {
  it('stores and retrieves values', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('missing')).toBe(false);
  });

  it('returns undefined for unknown keys', () => {
    const cache = new LRUCache<string, number>(2);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts the least-recently-used entry when capacity is exceeded', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    // Inserting a third entry should drop 'a' (oldest, never accessed).
    cache.set('c', 3);

    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('get() promotes recency so the touched key survives eviction', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);

    // Touch 'a' so 'b' becomes the LRU.
    expect(cache.get('a')).toBe(1);

    cache.set('c', 3);

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('set() on an existing key updates the value and promotes recency', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);

    cache.set('a', 99); // updates and promotes 'a'

    cache.set('c', 3); // should evict 'b', not 'a'

    expect(cache.get('a')).toBe(99);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('clear() empties the cache', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
  });

  it('throws for non-positive capacity', () => {
    expect(() => new LRUCache<string, number>(0)).toThrow();
    expect(() => new LRUCache<string, number>(-1)).toThrow();
  });
});
