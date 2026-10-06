import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../../auth/tenant-context';
import { RedisService } from '../../redis/redis.service';
import { codedError } from '../../../common/api-error';

const WINDOW_SECONDS = 60;
/** OAuth starts per user per minute (M4a). */
export const OAUTH_START_MAX_PER_WINDOW = 10;
/** OAuth callbacks per client IP per minute (M4a). */
export const OAUTH_CALLBACK_MAX_PER_WINDOW = 60;

/**
 * Fixed-window counter shared by the two OAuth limiters: Redis when
 * available, an in-memory bucket otherwise (single instance only, the same
 * fallback as the other public limiters).
 */
abstract class FixedWindowGuard implements CanActivate {
  private readonly memoryCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  protected abstract keyOf(context: ExecutionContext): string;
  protected abstract readonly max: number;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const count = await this.increment(this.keyOf(context));
    if (count > this.max) {
      throw new HttpException(codedError('OAUTH_RATE_LIMITED', { statusCode: 429 }), HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private async increment(key: string): Promise<number> {
    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const count = await client.incr(key);
        if (count === 1) await client.expire(key, WINDOW_SECONDS);
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

/** POST /platform/integrations/oauth/:provider/start, keyed by the authenticated user (runs after the JWT guard). */
@Injectable()
export class OAuthStartRateLimitGuard extends FixedWindowGuard {
  protected readonly max = OAUTH_START_MAX_PER_WINDOW;

  constructor(redis: RedisService) {
    super(redis);
  }

  protected keyOf(context: ExecutionContext): string {
    return `oauth-start-rl:${context.switchToHttp().getRequest<AuthenticatedRequest>().user?.id ?? 'anon'}`;
  }
}

/** GET /platform/integrations/oauth/:provider/callback (public), keyed by client IP (trust proxy 1). */
@Injectable()
export class OAuthCallbackRateLimitGuard extends FixedWindowGuard {
  protected readonly max = OAUTH_CALLBACK_MAX_PER_WINDOW;

  constructor(redis: RedisService) {
    super(redis);
  }

  protected keyOf(context: ExecutionContext): string {
    return `oauth-callback-rl:${context.switchToHttp().getRequest<Request>().ip ?? 'unknown'}`;
  }
}
