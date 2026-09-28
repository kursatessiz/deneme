import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { RedisService } from '../redis/redis.service';

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 30;

/**
 * Fixed-window IP limiter for the public Caddy on-demand TLS "ask" endpoint
 * (docs/SAYFA_MOTORU.md). Same pattern as LeadsPublicRateLimitGuard: Redis
 * when configured, an in-memory fallback otherwise (single instance only).
 */
@Injectable()
export class SitesPublicRateLimitGuard implements CanActivate {
  private readonly memoryCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? 'unknown';

    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const key = `sites-ask-rl:${ip}`;
        const count = await client.incr(key);
        if (count === 1) await client.expire(key, WINDOW_SECONDS);
        if (count > MAX_REQUESTS) throw new HttpException('Çok fazla istek', HttpStatus.TOO_MANY_REQUESTS);
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
    if (entry.count > MAX_REQUESTS) throw new HttpException('Çok fazla istek', HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}
