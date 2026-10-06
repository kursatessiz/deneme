import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { RedisService } from '../redis/redis.service';
import { apiError } from '../../common/api-error';

const WINDOW_SECONDS = 60;

/**
 * Fixed-window IP limiter for the page engine's directly reachable public
 * endpoints (docs/SAYFA_MOTORU.md). Same pattern as LeadsPublicRateLimitGuard:
 * Redis when configured, an in-memory fallback otherwise (single instance
 * only). Each subclass has its own bucket and budget.
 */
abstract class SitesFixedWindowGuard implements CanActivate {
  private readonly memoryCounters = new Map<string, { count: number; resetAt: number }>();

  protected abstract readonly bucket: string;
  protected abstract readonly maxRequests: number;

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? 'unknown';

    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const key = `${this.bucket}:${ip}`;
        const count = await client.incr(key);
        if (count === 1) await client.expire(key, WINDOW_SECONDS);
        if (count > this.maxRequests) throw new HttpException(apiError('apiErrors.common.tooManyRequests'), HttpStatus.TOO_MANY_REQUESTS);
        return true;
      } catch (err) {
        if (err instanceof HttpException) throw err;
      }
    }
    return this.checkMemory(ip);
  }

  private checkMemory(ip: string): boolean {
    const now = Date.now();
    const entry = this.memoryCounters.get(ip);
    if (!entry || entry.resetAt <= now) {
      this.memoryCounters.set(ip, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 });
      return true;
    }
    entry.count += 1;
    if (entry.count > this.maxRequests) throw new HttpException(apiError('apiErrors.common.tooManyRequests'), HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}

/** The Caddy on-demand TLS "ask" endpoint: 30 requests a minute per IP. */
@Injectable()
export class SitesPublicRateLimitGuard extends SitesFixedWindowGuard {
  protected readonly bucket = 'sites-ask-rl';
  protected readonly maxRequests = 30;

  constructor(redis: RedisService) {
    super(redis);
  }
}

/**
 * The RSS feed endpoint, polled directly by feed readers (the web app's own
 * feed route and pages read the cached list endpoints instead): 60 a minute per IP.
 */
@Injectable()
export class SitesFeedRateLimitGuard extends SitesFixedWindowGuard {
  protected readonly bucket = 'sites-feed-rl';
  protected readonly maxRequests = 60;

  constructor(redis: RedisService) {
    super(redis);
  }
}
