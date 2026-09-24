import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

const DEFAULT_TTL_SECONDS = 65;
/** Bound on the in-memory fallback so an idle process cannot grow unbounded. */
const MEMORY_CLEANUP_THRESHOLD = 2000;

/**
 * Replay guard for dynamic member QR nonces (W17). `claim` returns true the
 * first time a nonce is seen and false on every replay within the token's
 * TTL. Uses Redis `SET NX EX` when REDIS_URL is configured, which is shared
 * across API replicas; otherwise falls back to an in-memory map, which is
 * single-instance only (fine for local dev and tests, not for a multi-
 * replica production deployment without Redis -- see docs/CHECKIN.md).
 */
@Injectable()
export class DynamicQrNonceStore {
  private readonly memory = new Map<string, number>();

  constructor(private readonly redis: RedisService) {}

  async claim(nonce: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): Promise<boolean> {
    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const result = await client.set(`checkin-qr-nonce:${nonce}`, '1', 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      } catch {
        // Redis unreachable mid-request: fall through to the in-memory bucket.
      }
    }
    return this.claimMemory(nonce, ttlSeconds);
  }

  private claimMemory(nonce: string, ttlSeconds: number): boolean {
    this.cleanup();
    const now = Date.now();
    const expiresAt = this.memory.get(nonce);
    if (expiresAt !== undefined && expiresAt > now) return false;
    this.memory.set(nonce, now + ttlSeconds * 1000);
    return true;
  }

  private cleanup(): void {
    if (this.memory.size < MEMORY_CLEANUP_THRESHOLD) return;
    const now = Date.now();
    for (const [nonce, expiresAt] of this.memory) {
      if (expiresAt <= now) this.memory.delete(nonce);
    }
  }
}
