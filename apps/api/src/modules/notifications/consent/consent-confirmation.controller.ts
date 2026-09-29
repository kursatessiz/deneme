import { CanActivate, Controller, ExecutionContext, HttpCode, HttpException, HttpStatus, Injectable, Param, Post, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { ConsentConfirmResultDTO } from '@platform/shared';
import { RedisService } from '../../redis/redis.service';
import { ConsentConfirmationService } from './consent-confirmation.service';

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 20;

/**
 * Fixed-window limiter for the public confirmation endpoint, keyed by
 * client IP, same pattern as LeadsPublicRateLimitGuard: Redis when
 * configured, otherwise an in-memory counter (single instance only). The
 * token itself is 256 random bits; the limit is defence in depth.
 */
@Injectable()
export class ConsentConfirmRateLimitGuard implements CanActivate {
  private readonly memoryCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? 'unknown';
    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const key = `consent-confirm-rl:${ip}`;
        const count = await client.incr(key);
        if (count === 1) await client.expire(key, WINDOW_SECONDS);
        if (count > MAX_REQUESTS) throw new HttpException('Çok fazla istek, lütfen daha sonra tekrar deneyin', HttpStatus.TOO_MANY_REQUESTS);
        return true;
      } catch (err) {
        if (err instanceof HttpException) throw err;
        // Redis unreachable mid-request: fall through to the in-memory bucket.
      }
    }
    const now = Date.now();
    const entry = this.memoryCounters.get(ip);
    if (!entry || entry.resetAt <= now) {
      this.memoryCounters.set(ip, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 });
      return true;
    }
    entry.count += 1;
    if (entry.count > MAX_REQUESTS) throw new HttpException('Çok fazla istek, lütfen daha sonra tekrar deneyin', HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}

/**
 * Public, unauthenticated double opt-in confirmation (M3e). The web page
 * /onay/<token> posts here when the person presses the button (a POST, so
 * link scanners that prefetch e-mail links never confirm on their own).
 * The answer is neutral: CONFIRMED or INVALID, nothing about the person.
 */
@Controller('public/consent')
export class PublicConsentConfirmationController {
  constructor(private readonly confirmations: ConsentConfirmationService) {}

  @Post('confirm/:token')
  @HttpCode(200)
  @UseGuards(ConsentConfirmRateLimitGuard)
  confirm(@Param('token') token: string): Promise<ConsentConfirmResultDTO> {
    return this.confirmations.confirm(token);
  }
}
