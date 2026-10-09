import { ExecutionContext, HttpException } from '@nestjs/common';
import { EmbedRateLimitGuard } from './embed-rate-limit.guard';
import type { RedisService } from '../redis/redis.service';

function contextFor(req: { ip: string; headers: Record<string, string>; socket: { remoteAddress: string } }): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('EmbedRateLimitGuard', () => {
  const redis = { getClient: () => null } as unknown as RedisService;

  it('does not count the web container server renders (private peer, no X-Forwarded-For)', async () => {
    const guard = new EmbedRateLimitGuard(redis);
    const internal = contextFor({ ip: '::ffff:172.18.0.5', headers: {}, socket: { remoteAddress: '::ffff:172.18.0.5' } });
    for (let i = 0; i < 100; i += 1) {
      await expect(guard.canActivate(internal)).resolves.toBe(true);
    }
  });

  it('still limits a visitor that came through the proxy', async () => {
    const guard = new EmbedRateLimitGuard(redis);
    const visitor = contextFor({ ip: '203.0.113.9', headers: { 'x-forwarded-for': '203.0.113.9' }, socket: { remoteAddress: '::ffff:172.18.0.2' } });
    for (let i = 0; i < 30; i += 1) {
      await expect(guard.canActivate(visitor)).resolves.toBe(true);
    }
    await expect(guard.canActivate(visitor)).rejects.toBeInstanceOf(HttpException);
  });
});
