import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { RedisService } from '../redis/redis.service';

const WINDOW_SECONDS = 300;
const MAX_REQUESTS = 60;

/**
 * Fixed-window limiter for the public, unauthenticated ICS feed
 * (GET /calendar/:token.ics). Keyed by client IP plus the requested token
 * so one guessed token cannot be hammered, and one client cannot scan many
 * tokens. No-ops (fails open) when Redis is not configured, e.g. local dev.
 */
@Injectable()
export class CalendarFeedRateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = this.redis.getClient();
    if (!client) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = String(req.params.token ?? 'unknown');
    const key = `calendar-feed-rl:${req.ip}:${token.slice(0, 16)}`;

    try {
      if (client.status === 'wait') await client.connect();
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, WINDOW_SECONDS);
      if (count > MAX_REQUESTS) {
        throw new HttpException('Cok fazla istek', HttpStatus.TOO_MANY_REQUESTS);
      }
      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis unreachable: fail open rather than take the public feed down.
      return true;
    }
  }
}
