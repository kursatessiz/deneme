import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { LeadsPublicRateLimitGuard } from '../modules/crm/leads-compat/leads-public-rate-limit.guard';
import { EventsPublicRateLimitGuard } from '../modules/events/events-public.controller';
import { EmbedRateLimitGuard } from '../modules/public-api/embed-rate-limit.guard';
import { CommunityPublicRateLimitGuard } from '../modules/community/community-public.controller';
import { ConsentConfirmRateLimitGuard } from '../modules/notifications/consent/consent-confirmation.controller';
import type { RedisService } from '../modules/redis/redis.service';

const noRedis = { getClient: () => null } as unknown as RedisService;

type Guard = { canActivate(context: ExecutionContext): Promise<boolean> };
const guards: [string, () => Guard][] = [
  ['leads', () => new LeadsPublicRateLimitGuard(noRedis)],
  ['events', () => new EventsPublicRateLimitGuard(noRedis)],
  ['embed', () => new EmbedRateLimitGuard(noRedis)],
  ['community', () => new CommunityPublicRateLimitGuard(noRedis)],
  ['consent confirm', () => new ConsentConfirmRateLimitGuard(noRedis)],
];

/** A request from a public peer with a forwarded client address, as the guards see it behind the proxy. */
function contextFor(ip: string): ExecutionContext {
  const req = { ip, method: 'POST', headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip }, body: {} };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe.each(guards)('%s rate limit guard (in-memory fallback)', (_name, make) => {
  it('counts every address of one IPv6 /64 as one client', async () => {
    const guard = make();
    let limited = false;
    for (let i = 0; i < 400 && !limited; i += 1) {
      try {
        await guard.canActivate(contextFor(`2001:db8:aaaa:1:${i.toString(16)}::${(i * 7).toString(16)}`));
      } catch (err) {
        if (err instanceof HttpException && err.getStatus() === 429) limited = true;
        else throw err;
      }
    }
    expect(limited).toBe(true);
  });

  it('does not mix different /64 prefixes', async () => {
    const guard = make();
    for (let i = 0; i < 3; i += 1) {
      await expect(guard.canActivate(contextFor(`2001:db8:bbbb:${i.toString(16)}::1`))).resolves.toBe(true);
    }
  });
});

describe('in-memory fallback size', () => {
  it('stays bounded when many distinct clients arrive', async () => {
    const guard = new LeadsPublicRateLimitGuard(noRedis);
    for (let i = 0; i < 10_500; i += 1) {
      await guard.canActivate(contextFor(`${(i >> 16) + 1}.${(i >> 8) & 255}.${i & 255}.1`));
    }
    const counters = (guard as unknown as { memoryCounters: Map<string, unknown> }).memoryCounters;
    expect(counters.size).toBeLessThanOrEqual(10_000);
  });
});
