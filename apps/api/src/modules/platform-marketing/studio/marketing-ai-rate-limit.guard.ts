import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/tenant-context';
import { RedisService } from '../../redis/redis.service';
import { incrementWithTtl } from '../../redis/increment-with-ttl';
import { codedError } from '../../../common/api-error';

const WINDOW_SECONDS = 60;
/** Model calls per user per minute (docs/PAZARLAMA_MODULU.md 6.2). */
export const MARKETING_AI_MAX_PER_WINDOW = 10;

/**
 * Fixed-window limiter for the endpoints that call the model, keyed by user.
 * Redis when available, an in-memory bucket otherwise (same approach as the
 * ads action limiter).
 */
@Injectable()
export class MarketingAiRateLimitGuard implements CanActivate {
  private readonly memoryCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const count = await this.increment(`mkt-ai-rl:${req.user?.id ?? 'anon'}`);
    if (count > MARKETING_AI_MAX_PER_WINDOW) {
      throw new HttpException(codedError('MARKETING_AI_RATE_LIMITED', { statusCode: 429 }), HttpStatus.TOO_MANY_REQUESTS);
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
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }
}
