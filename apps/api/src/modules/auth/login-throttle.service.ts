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
 * Brute-force protection for password and PIN login. Only failed attempts
 * are counted, so normal sign-ins never consume the budget; a successful
 * login clears the identifier's counter. Counters live in Redis when
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

  /** Throws 429 when either the identifier or the IP is over its failure budget. */
  async assertAllowed(kind: LoginThrottleKind, identifier: string, ip: string | null): Promise<void> {
    const [byId, byIp] = await Promise.all([
      this.read(this.key(kind, 'id', identifier)),
      ip ? this.read(this.key(kind, 'ip', ip)) : Promise.resolve(0),
    ]);
    if (byId >= LOGIN_MAX_FAILURES_PER_IDENTIFIER || byIp >= LOGIN_MAX_FAILURES_PER_IP) {
      throw new HttpException(TOO_MANY, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async recordFailure(kind: LoginThrottleKind, identifier: string, ip: string | null): Promise<void> {
    await Promise.all([this.increment(this.key(kind, 'id', identifier)), ip ? this.increment(this.key(kind, 'ip', ip)) : Promise.resolve()]);
  }

  async recordSuccess(kind: LoginThrottleKind, identifier: string): Promise<void> {
    await this.clear(this.key(kind, 'id', identifier));
  }

  private key(kind: LoginThrottleKind, bucket: Bucket, value: string): string {
    const digest = createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32);
    return `login-fail:${kind}:${bucket}:${digest}`;
  }

  private async read(key: string): Promise<number> {
    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const value = await client.get(key);
        return value ? Number(value) : 0;
      } catch {
        // Redis unreachable: fall back to the in-memory window below.
      }
    }
    const entry = this.memory.get(key);
    return entry && entry.resetAt > Date.now() ? entry.count : 0;
  }

  private async increment(key: string): Promise<void> {
    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const count = await incrementWithTtl(client, key, LOGIN_FAILURE_WINDOW_SECONDS);
        return;
      } catch {
        // Fall through to memory.
      }
    }
    const now = Date.now();
    const entry = this.memory.get(key);
    if (!entry || entry.resetAt <= now) this.memory.set(key, { count: 1, resetAt: now + LOGIN_FAILURE_WINDOW_SECONDS * 1000 });
    else entry.count += 1;
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
