import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/tenant-context';
import { RedisService } from '../redis/redis.service';
import { incrementWithTtl } from '../redis/increment-with-ttl';
import { apiError } from '../../common/api-error';

const WINDOW_SECONDS = 300;
const MAX_REQUESTS = 10;

/**
 * Fixed-window limiter for the member self-service gift card balance check
 * (GET /promotions/gift-cards/check), keyed by the caller's user id so one
 * account cannot brute-force gift card codes. No-ops (fails open) when Redis
 * is not configured, e.g. local dev.
 */
@Injectable()
export class GiftCardRateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = this.redis.getClient();
    if (!client) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const key = `gift-card-check-rl:${req.user?.id ?? 'unknown'}`;

    try {
      if (client.status === 'wait') await client.connect();
      const count = await incrementWithTtl(client, key, WINDOW_SECONDS);
      if (count > MAX_REQUESTS) {
        throw new HttpException(apiError('apiErrors.common.tooManyAttemptsShortly'), HttpStatus.TOO_MANY_REQUESTS);
      }
      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      return true;
    }
  }
}
