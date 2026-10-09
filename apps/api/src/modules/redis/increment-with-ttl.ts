import type Redis from 'ioredis';

/**
 * INCR and EXPIRE in one server-side step. Setting the TTL in a second
 * round trip only when the count is 1 leaves a key without any TTL if the
 * process dies (or the connection drops) in between, and that counter then
 * never resets: a permanent lockout. The script also repairs such a key
 * (TTL -1) the next time it is touched.
 */
export const INCREMENT_WITH_TTL_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

export type CounterClient = Pick<Redis, 'eval'>;

/** Increments a fixed-window counter and guarantees it expires; returns the new count. */
export async function incrementWithTtl(client: CounterClient, key: string, ttlSeconds: number): Promise<number> {
  const result = await client.eval(INCREMENT_WITH_TTL_SCRIPT, 1, key, ttlSeconds);
  return Number(result);
}
