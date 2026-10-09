import { INCREMENT_WITH_TTL_SCRIPT, incrementWithTtl, type CounterClient } from './increment-with-ttl';

/**
 * In-memory stand-in for the Lua script's semantics (INCR, TTL, EXPIRE on
 * one key, run atomically as Redis runs a script). TTL -1 means "no expiry".
 */
function fakeRedis() {
  const values = new Map<string, number>();
  const ttls = new Map<string, number>();
  const calls: unknown[][] = [];
  const client = {
    eval: jest.fn(async (...args: unknown[]) => {
      calls.push(args);
      const [script, numKeys, key, ttl] = args as [string, number, string, number];
      expect(script).toBe(INCREMENT_WITH_TTL_SCRIPT);
      expect(numKeys).toBe(1);
      const count = (values.get(key) ?? 0) + 1;
      values.set(key, count);
      if (count === 1 || (ttls.get(key) ?? -1) < 0) ttls.set(key, ttl);
      return count;
    }),
  };
  return { client: client as unknown as CounterClient & { eval: jest.Mock }, values, ttls, calls };
}

describe('incrementWithTtl', () => {
  it('increments and sets the TTL in a single server call', async () => {
    const redis = fakeRedis();
    expect(await incrementWithTtl(redis.client, 'rl:a', 60)).toBe(1);
    expect(await incrementWithTtl(redis.client, 'rl:a', 60)).toBe(2);
    expect(redis.client.eval).toHaveBeenCalledTimes(2);
    expect(redis.calls[0]).toEqual([INCREMENT_WITH_TTL_SCRIPT, 1, 'rl:a', 60]);
    expect(redis.ttls.get('rl:a')).toBe(60);
  });

  it('gives a key left without a TTL (count already above 1) an expiry again', async () => {
    const redis = fakeRedis();
    redis.values.set('rl:stuck', 7);
    redis.ttls.set('rl:stuck', -1);
    expect(await incrementWithTtl(redis.client, 'rl:stuck', 900)).toBe(8);
    expect(redis.ttls.get('rl:stuck')).toBe(900);
  });

  it('the script expires the key whenever it has no TTL, not only on the first hit', () => {
    expect(INCREMENT_WITH_TTL_SCRIPT).toContain("redis.call('INCR', KEYS[1])");
    expect(INCREMENT_WITH_TTL_SCRIPT).toContain("redis.call('TTL', KEYS[1]) < 0");
    expect(INCREMENT_WITH_TTL_SCRIPT).toContain("redis.call('EXPIRE', KEYS[1], ARGV[1])");
  });

  it('returns a number even when the client answers with a string', async () => {
    const client = { eval: jest.fn(async () => '3') } as unknown as CounterClient;
    expect(await incrementWithTtl(client, 'rl:b', 60)).toBe(3);
  });
});
