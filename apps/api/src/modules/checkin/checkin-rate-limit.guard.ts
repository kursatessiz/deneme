import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/tenant-context';
import { RedisService } from '../redis/redis.service';

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 12;

/**
 * Fixed-window limiter for POST /me/check-in/scan, keyed by the caller's
 * user id (the route is authenticated, unlike the public lead form) so a
 * compromised or looping client cannot hammer the check-in path. Same
 * Redis-with-fail-open shape as GiftCardRateLimitGuard: a scan is a
 * low-risk read-mostly action, so an unreachable Redis should not block it.
 */
@Injectable()
export class CheckInScanRateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = this.redis.getClient();
    if (!client) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const key = `checkin-scan-rl:${req.user?.id ?? 'unknown'}`;

    try {
      if (client.status === 'wait') await client.connect();
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, WINDOW_SECONDS);
      if (count > MAX_REQUESTS) {
        throw new HttpException('Çok fazla deneme, biraz sonra tekrar deneyin', HttpStatus.TOO_MANY_REQUESTS);
      }
      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      return true;
    }
  }
}

/**
 * Fixed-window limiter for the public POST /kiosk/pair exchange, keyed by
 * IP. Unlike the scan guard above this does NOT fail open: pairing hands
 * out a long-lived kiosk token from a short human-typed code, so it stays
 * bounded even without Redis (in-memory fallback, single instance only).
 */
@Injectable()
export class KioskPairRateLimitGuard implements CanActivate {
  private readonly memoryCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ ip?: string }>();
    const ip = req.ip ?? 'unknown';

    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const key = `kiosk-pair-rl:${ip}`;
        const count = await client.incr(key);
        if (count === 1) await client.expire(key, WINDOW_SECONDS);
        if (count > MAX_REQUESTS) {
          throw new HttpException('Çok fazla deneme, biraz sonra tekrar deneyin', HttpStatus.TOO_MANY_REQUESTS);
        }
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
    if (entry.count > MAX_REQUESTS) {
      throw new HttpException('Çok fazla deneme, biraz sonra tekrar deneyin', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
