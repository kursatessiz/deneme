import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import type { ApiKeyAuthenticatedRequest } from './api-key-tenant-context';

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 120;

/**
 * Fixed-window limiter for `/v1/public/*`, keyed by API key id (not IP: a
 * studio's integration may call through a shared gateway). Same
 * Redis-with-in-memory-fallback shape as LeadsPublicRateLimitGuard; must run
 * after ApiKeyGuard so request.apiKeyTenant is populated.
 */
@Injectable()
export class ApiKeyRateLimitGuard implements CanActivate {
  private readonly memoryCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiKeyAuthenticatedRequest>();
    const keyId = req.apiKeyTenant?.apiKeyId ?? 'unknown';

    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const key = `api-key-rl:${keyId}`;
        const count = await client.incr(key);
        if (count === 1) await client.expire(key, WINDOW_SECONDS);
        if (count > MAX_REQUESTS) {
          throw new HttpException('Çok fazla istek, lütfen daha sonra tekrar deneyin', HttpStatus.TOO_MANY_REQUESTS);
        }
        return true;
      } catch (err) {
        if (err instanceof HttpException) throw err;
      }
    }

    return this.checkMemory(keyId);
  }

  private checkMemory(keyId: string): boolean {
    const now = Date.now();
    const entry = this.memoryCounters.get(keyId);
    if (!entry || entry.resetAt <= now) {
      this.memoryCounters.set(keyId, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 });
      return true;
    }
    entry.count += 1;
    if (entry.count > MAX_REQUESTS) {
      throw new HttpException('Çok fazla istek, lütfen daha sonra tekrar deneyin', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
