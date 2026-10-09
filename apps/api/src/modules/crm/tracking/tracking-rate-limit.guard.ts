import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { RedisService } from '../../redis/redis.service';
import { incrementWithTtl } from '../../redis/increment-with-ttl';
import { apiError } from '../../../common/api-error';

const WINDOW_SECONDS = 60;
/** Per client IP: a busy office or mobile carrier NAT shares one address. */
export const TRACKING_MAX_PER_IP = 60;
/** Per visitor id: one browser sends one touchpoint per session plus tagged landings. */
export const TRACKING_MAX_PER_VISITOR = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fixed-window limiter for POST /track/:studioSlug/touchpoint, keyed by
 * client IP and by the visitor id in the body. Uses Redis when configured
 * and falls back to an in-memory counter (single instance only), like the
 * public lead form limiter: a public write endpoint must stay limited even
 * without Redis.
 */
@Injectable()
export class TrackingRateLimitGuard implements CanActivate {
  private readonly memoryCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const keys: [string, number][] = [[`track-rl:ip:${req.ip ?? 'unknown'}`, TRACKING_MAX_PER_IP]];
    const visitorId = (req.body as { visitorId?: unknown } | undefined)?.visitorId;
    if (typeof visitorId === 'string' && UUID.test(visitorId)) {
      keys.push([`track-rl:vid:${visitorId.toLowerCase()}`, TRACKING_MAX_PER_VISITOR]);
    }

    for (const [key, max] of keys) {
      const count = await this.increment(key);
      if (count > max) {
        throw new HttpException(apiError('apiErrors.common.tooManyRequestsLater'), HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    return true;
  }

  private async increment(key: string): Promise<number> {
    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const count = await incrementWithTtl(client, key, WINDOW_SECONDS);
        return count;
      } catch {
        // Redis unreachable mid-request: fall through to the in-memory bucket.
      }
    }
    const now = Date.now();
    const entry = this.memoryCounters.get(key);
    if (!entry || entry.resetAt <= now) {
      this.memoryCounters.set(key, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 });
      if (this.memoryCounters.size > 50_000) this.evictExpired(now);
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  private evictExpired(now: number): void {
    for (const [key, entry] of this.memoryCounters) {
      if (entry.resetAt <= now) this.memoryCounters.delete(key);
    }
  }
}
