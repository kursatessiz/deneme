import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { RedisService } from '../redis/redis.service';

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 5;

/**
 * Fixed-window limiter for the public, unauthenticated lead form
 * (POST /public/studios/:slug/leads), keyed by client IP. Uses Redis when
 * configured, same as CalendarFeedRateLimitGuard.
 *
 * Unlike the calendar feed guard, this one does NOT fail open when Redis is
 * unavailable: it falls back to an in-memory fixed-window counter instead,
 * since a public write endpoint (rather than a public read) is a spam/abuse
 * target worth limiting even on a single instance with no Redis configured.
 * That fallback is single-instance only -- it does not share state across
 * API replicas -- so production deployments should configure REDIS_URL.
 */
@Injectable()
export class LeadsPublicRateLimitGuard implements CanActivate {
  private readonly memoryCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? 'unknown';

    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const key = `leads-public-rl:${ip}`;
        const count = await client.incr(key);
        if (count === 1) await client.expire(key, WINDOW_SECONDS);
        if (count > MAX_REQUESTS) {
          throw new HttpException('Çok fazla istek, lütfen daha sonra tekrar deneyin', HttpStatus.TOO_MANY_REQUESTS);
        }
        return true;
      } catch (err) {
        if (err instanceof HttpException) throw err;
        // Redis unreachable mid-request: fall through to the in-memory bucket below.
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
    if (entry.count > MAX_REQUESTS) {
      throw new HttpException('Çok fazla istek, lütfen daha sonra tekrar deneyin', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
