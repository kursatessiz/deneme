import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../redis/redis.service';
import { incrementWithTtl } from '../redis/increment-with-ttl';
import { apiError } from '../../common/api-error';

/** Failed attempts allowed per account identifier (phone or email) per window. */
export const LOGIN_MAX_FAILURES_PER_IDENTIFIER = 10;
/** Failed attempts allowed per client IP per window, across all identifiers (credential stuffing). */
export const LOGIN_MAX_FAILURES_PER_IP = 50;
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;

const TOO_MANY = apiError('apiErrors.auth.tooManyFailedSignAttemptsLater');

type Bucket = 'id' | 'ip';
/** 'mfa': TOTP and recovery code attempts, keyed by user id (M1). */
export type LoginThrottleKind = 'password' | 'pin' | 'mfa';

/**
 * Brute-force protection for password, PIN and MFA verification. An attempt is
 * reserved before the credential is evaluated; a successful check clears the
 * identifier's counter and refunds the IP's, so normal sign-ins never consume
 * the budget. Counters live in Redis when
 * configured, otherwise in a single-instance in-memory fixed window (the
 * same fallback as LeadsPublicRateLimitGuard).
 *
 * Identifiers are stored hashed so phone numbers and emails never appear in
 * Redis keys. OTP login is not throttled here: OtpService has its own
 * per-phone/IP limits and attempt cap, and it stays the recovery path when
 * a password is locked out.
 */
@Injectable()
export class LoginThrottleService {
  private readonly memory = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  /**
   * Reserves one attempt before the credential is evaluated and throws 429 when
   * that attempt exceeds the identifier or IP budget. The counters are
   * incremented first (atomically in Redis, synchronously in memory) so a
   * parallel burst cannot evaluate more guesses than the cap. A successful
   * credential check calls recordSuccess, which gives the attempt back.
   */
  async reserveAttempt(kind: LoginThrottleKind, identifier: string, ip: string | null): Promise<void> {
    const [byId, byIp] = await Promise.all([
      this.increment(this.key(kind, 'id', identifier)),
      ip ? this.increment(this.key(kind, 'ip', ip)) : Promise.resolve(0),
    ]);
    if (byId > LOGIN_MAX_FAILURES_PER_IDENTIFIER || byIp > LOGIN_MAX_FAILURES_PER_IP) {
      throw new HttpException(TOO_MANY, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Clears the identifier's counter and refunds the IP's reserved attempt. */
  async recordSuccess(kind: LoginThrottleKind, identifier: string, ip: string | null): Promise<void> {
    await Promise.all([this.clear(this.key(kind, 'id', identifier)), ip ? this.refund(this.key(kind, 'ip', ip)) : Promise.resolve()]);
  }

  private key(kind: LoginThrottleKind, bucket: Bucket, value: string): string {
    const digest = createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32);
    return `login-fail:${kind}:${bucket}:${digest}`;
  }

  /**
   * Increments the counter and returns the new value. With no Redis client the
   * in-memory branch runs before any await, so concurrent callers are counted
   * one by one in call order.
   */
  private async increment(key: string): Promise<number> {
    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        return await incrementWithTtl(client, key, LOGIN_FAILURE_WINDOW_SECONDS);
      } catch {
        // Fall through to memory.
      }
    }
    const now = Date.now();
    const entry = this.memory.get(key);
    if (!entry || entry.resetAt <= now) {
      this.memory.set(key, { count: 1, resetAt: now + LOGIN_FAILURE_WINDOW_SECONDS * 1000 });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  private async refund(key: string): Promise<void> {
    const entry = this.memory.get(key);
    if (entry && entry.count > 0) entry.count -= 1;
    const client = this.redis.getClient();
    if (!client) return;
    try {
      if (client.status === 'wait') await client.connect();
      if ((await client.decr(key)) <= 0) await client.del(key);
    } catch {
      // Best effort: the key expires on its own.
    }
  }

  private async clear(key: string): Promise<void> {
    this.memory.delete(key);
    const client = this.redis.getClient();
    if (!client) return;
    try {
      if (client.status === 'wait') await client.connect();
      await client.del(key);
    } catch {
      // Best effort: the key expires on its own.
    }
  }
}
