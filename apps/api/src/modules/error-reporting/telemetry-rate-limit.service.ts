import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../redis/redis.service';
import { incrementWithTtl } from '../redis/increment-with-ttl';

/** Ingest requests allowed per client IP per window. */
export const TELEMETRY_MAX_PER_IP = 60;
/** Ingest requests allowed per session (user id, or the client's random session id) per window. */
export const TELEMETRY_MAX_PER_SESSION = 20;
export const TELEMETRY_WINDOW_SECONDS = 60;
/** Upper bound of in-memory keys; expired ones are pruned first. */
const MEMORY_KEY_LIMIT = 10_000;

export type TelemetryBucket = 'ip' | 'session';

/**
 * Fixed-window limiter for POST /telemetry/errors, in the style of
 * LoginThrottleService: Redis when configured, a single-instance in-memory
 * window otherwise (or when Redis is unreachable). Keys are sha256 digests,
 * so IPs and user ids never appear in Redis.
 */
@Injectable()
export class TelemetryRateLimiter {
  private readonly memory = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  /** Counts one request; false when the bucket is over its limit. */
  async consume(bucket: TelemetryBucket, value: string, limit: number): Promise<boolean> {
    const key = this.key(bucket, value);
    const count = await this.increment(key);
    return count <= limit;
  }

  /** Clears the in-memory windows (tests and local runs). */
  reset(): void {
    this.memory.clear();
  }

  private key(bucket: TelemetryBucket, value: string): string {
    const digest = createHash('sha256').update(value).digest('hex').slice(0, 32);
    return `telemetry-rl:${bucket}:${digest}`;
  }

  private async increment(key: string): Promise<number> {
    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const count = await incrementWithTtl(client, key, TELEMETRY_WINDOW_SECONDS);
        return count;
      } catch {
        // Redis unreachable: fall back to the in-memory window.
      }
    }
    const now = Date.now();
    const entry = this.memory.get(key);
    if (!entry || entry.resetAt <= now) {
      if (this.memory.size >= MEMORY_KEY_LIMIT) this.prune(now);
      this.memory.set(key, { count: 1, resetAt: now + TELEMETRY_WINDOW_SECONDS * 1000 });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.memory) if (entry.resetAt <= now) this.memory.delete(key);
    // Still full: drop the oldest windows rather than grow without bound.
    while (this.memory.size >= MEMORY_KEY_LIMIT) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
  }
}
