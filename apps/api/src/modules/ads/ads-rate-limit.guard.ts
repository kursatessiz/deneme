import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/tenant-context';
import { RedisService } from '../redis/redis.service';

const WINDOW_SECONDS = 60;
/** Test-connection and manual spend-sync are cheap but call a real third party; a tight per-membership limit is enough to stop accidental hammering. */
export const ADS_ACTION_MAX_PER_WINDOW = 10;

/** Fixed-window limiter for the test-connection and manual sync endpoints, keyed by membership so one staff member cannot exhaust another's budget. */
@Injectable()
export class AdsRateLimitGuard implements CanActivate {
  private readonly memoryCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const key = `ads-rl:${req.tenant?.membershipId ?? req.user?.id ?? 'anon'}`;
    const count = await this.increment(key);
    if (count > ADS_ACTION_MAX_PER_WINDOW) {
      throw new HttpException('Çok fazla istek, lütfen daha sonra tekrar deneyin', HttpStatus.TOO_MANY_REQUESTS);
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
