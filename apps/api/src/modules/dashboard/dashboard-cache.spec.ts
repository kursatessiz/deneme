import { TtlPromiseCache } from './dashboard-cache';

describe('TtlPromiseCache', () => {
  it('reuses a value within the ttl and recomputes after it', async () => {
    let clock = 0;
    const cache = new TtlPromiseCache<number>(1000, 10, () => clock);
    let calls = 0;
    const factory = async () => ++calls;
    expect(await cache.getOrCreate('a', factory)).toBe(1);
    clock = 999;
    expect(await cache.getOrCreate('a', factory)).toBe(1);
    clock = 1000;
    expect(await cache.getOrCreate('a', factory)).toBe(2);
  });

  it('shares one in-flight computation', async () => {
    const cache = new TtlPromiseCache<number>(1000, 10);
    let calls = 0;
    const factory = () => new Promise<number>((resolve) => setTimeout(() => resolve(++calls), 5));
    const [a, b] = await Promise.all([cache.getOrCreate('k', factory), cache.getOrCreate('k', factory)]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(calls).toBe(1);
  });

  it('never keeps a failure', async () => {
    const cache = new TtlPromiseCache<number>(1000, 10);
    await expect(cache.getOrCreate('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await Promise.resolve();
    expect(await cache.getOrCreate('k', async () => 7)).toBe(7);
  });

  it('keeps separate keys apart and evicts the oldest past the bound', async () => {
    const cache = new TtlPromiseCache<string>(1000, 2);
    await cache.getOrCreate('a', async () => 'a');
    await cache.getOrCreate('b', async () => 'b');
    await cache.getOrCreate('c', async () => 'c');
    expect(cache.size).toBe(2);
    expect(await cache.getOrCreate('b', async () => 'other')).toBe('b');
    expect(await cache.getOrCreate('a', async () => 'fresh')).toBe('fresh');
  });
});
