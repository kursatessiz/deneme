import { CanActivate, Controller, ExecutionContext, Get, HttpException, HttpStatus, Injectable, Param, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RedisService } from '../redis/redis.service';
import { CommunityPostsService } from './community-posts.service';

const WINDOW_SECONDS = 60;
const MAX_READS = 60;

/**
 * Fixed-window IP limiter for the public share link, same pattern as
 * EventsPublicRateLimitGuard: Redis when configured, an in-memory fallback
 * otherwise (single instance only), never failing open.
 */
@Injectable()
export class CommunityPublicRateLimitGuard implements CanActivate {
  private readonly memoryCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const key = `community-public-rl:${req.ip ?? 'unknown'}`;

    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const count = await client.incr(key);
        if (count === 1) await client.expire(key, WINDOW_SECONDS);
        if (count > MAX_READS) throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
        return true;
      } catch (err) {
        if (err instanceof HttpException) throw err;
        // Redis unreachable mid-request: fall through to the in-memory bucket.
      }
    }

    const now = Date.now();
    const entry = this.memoryCounters.get(key);
    if (!entry || entry.resetAt <= now) {
      this.memoryCounters.set(key, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 });
      return true;
    }
    entry.count += 1;
    if (entry.count > MAX_READS) throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}

/**
 * Unauthenticated, read-only view of a post whose share link staff turned
 * on (docs/TOPLULUK.md "Paylaşım bağlantısı"). No comments, likes, author
 * or tier details; unknown, revoked and archived links all return 404.
 */
@Controller('public/community')
@UseGuards(CommunityPublicRateLimitGuard)
export class CommunityPublicController {
  constructor(private readonly posts: CommunityPostsService) {}

  @Get('posts/:token')
  get(@Param('token') token: string) {
    return this.posts.getPublic(token);
  }
}
