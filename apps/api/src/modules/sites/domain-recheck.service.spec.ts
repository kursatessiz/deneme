import { DOMAIN_RECHECK_FAILURE_LIMIT } from '@platform/shared';
import { DOMAIN_RECHECK_BATCH, DOMAIN_RECHECK_INTERVAL_MS, DomainRecheckService } from './domain-recheck.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DnsVerificationService } from './dns.service';
import type { SiteCacheService } from './site-cache.service';
import type { DomainNoticeService } from './domain-notice.service';

const now = new Date('2026-10-13T08:00:00Z');
const row = (id: string, domain: string) => ({ id, domain, verificationToken: `tok-${id}`, site: { studioId: `studio-${id}`, studio: { isPlatform: false } } });

function build(rows: ReturnType<typeof row>[], verify: jest.Mock, failureCount = 1) {
  const prisma = {
    siteDomain: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({ consecutiveFailures: failureCount }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const siteCache = { purgeDomain: jest.fn().mockResolvedValue(undefined) };
  const notices = { warnFirstFailure: jest.fn().mockResolvedValue(2), notifyDeactivated: jest.fn().mockResolvedValue(2) };
  const service = new DomainRecheckService(
    prisma as unknown as PrismaService,
    { verify } as unknown as DnsVerificationService,
    siteCache as unknown as SiteCacheService,
    notices as unknown as DomainNoticeService,
  );
  return { service, prisma, siteCache, notices };
}

describe('DomainRecheckService', () => {
  it('selects only VERIFIED domains not checked within a day, oldest first, bounded', async () => {
    const { service, prisma } = build([], jest.fn());
    await service.run(now);
    const args = prisma.siteDomain.findMany.mock.calls[0][0];
    expect(args.where.status).toBe('VERIFIED');
    expect(args.where.OR).toEqual([{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - DOMAIN_RECHECK_INTERVAL_MS) } }]);
    expect(args.take).toBe(DOMAIN_RECHECK_BATCH);
  });

  it('resets the counter on success and leaves the status alone', async () => {
    const { service, prisma, siteCache } = build([row('1', 'a.example.com')], jest.fn().mockResolvedValue(true));
    expect(await service.run(now)).toEqual({ checked: 1, failed: 0, deactivated: 0 });
    expect(prisma.siteDomain.updateMany).toHaveBeenCalledWith({ where: { id: '1', status: 'VERIFIED' }, data: { lastCheckedAt: now, consecutiveFailures: 0 } });
    expect(siteCache.purgeDomain).not.toHaveBeenCalled();
  });

  it('records a failure below the limit without deactivating', async () => {
    const { service, prisma, siteCache } = build([row('1', 'a.example.com')], jest.fn().mockResolvedValue(false), DOMAIN_RECHECK_FAILURE_LIMIT - 1);
    expect(await service.run(now)).toEqual({ checked: 1, failed: 1, deactivated: 0 });
    expect(prisma.siteDomain.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastCheckedAt: now, lastFailureAt: now, consecutiveFailures: { increment: 1 } } }),
    );
    expect(prisma.siteDomain.updateMany).not.toHaveBeenCalled();
    expect(siteCache.purgeDomain).not.toHaveBeenCalled();
  });

  it('deactivates on the third consecutive failure and purges the host and site caches', async () => {
    const { service, prisma, siteCache } = build([row('1', 'a.example.com')], jest.fn().mockResolvedValue(false), DOMAIN_RECHECK_FAILURE_LIMIT);
    expect(await service.run(now)).toEqual({ checked: 1, failed: 1, deactivated: 1 });
    expect(prisma.siteDomain.updateMany).toHaveBeenCalledWith({ where: { id: '1', status: 'VERIFIED' }, data: { status: 'FAILED', verifiedAt: null } });
    expect(siteCache.purgeDomain).toHaveBeenCalledWith('a.example.com', 'studio-1');
  });

  it('sends the warning on the first failure only, with the days left, and no deactivation notice', async () => {
    const { service, notices } = build([row('1', 'a.example.com')], jest.fn().mockResolvedValue(false), 1);
    await service.run(now);
    expect(notices.warnFirstFailure).toHaveBeenCalledTimes(1);
    expect(notices.warnFirstFailure).toHaveBeenCalledWith(
      { domainId: '1', domain: 'a.example.com', studioId: 'studio-1', isPlatformStudio: false, eventAt: now },
      DOMAIN_RECHECK_FAILURE_LIMIT - 1,
      expect.any(String),
    );
    expect(notices.notifyDeactivated).not.toHaveBeenCalled();
  });

  it('sends no warning on the second failure', async () => {
    const { service, notices } = build([row('1', 'a.example.com')], jest.fn().mockResolvedValue(false), 2);
    await service.run(now);
    expect(notices.warnFirstFailure).not.toHaveBeenCalled();
    expect(notices.notifyDeactivated).not.toHaveBeenCalled();
  });

  it('sends the deactivation notice once when the domain flips to FAILED', async () => {
    const { service, notices } = build([row('1', 'a.example.com')], jest.fn().mockResolvedValue(false), DOMAIN_RECHECK_FAILURE_LIMIT);
    await service.run(now);
    expect(notices.notifyDeactivated).toHaveBeenCalledTimes(1);
    expect(notices.notifyDeactivated).toHaveBeenCalledWith(expect.objectContaining({ domainId: '1', domain: 'a.example.com', studioId: 'studio-1' }));
    expect(notices.warnFirstFailure).not.toHaveBeenCalled();
  });

  it('sends no deactivation notice when another worker already flipped the domain', async () => {
    const { service, prisma, notices } = build([row('1', 'a.example.com')], jest.fn().mockResolvedValue(false), DOMAIN_RECHECK_FAILURE_LIMIT);
    prisma.siteDomain.updateMany.mockResolvedValue({ count: 0 });
    await service.run(now);
    expect(notices.notifyDeactivated).not.toHaveBeenCalled();
  });

  it('sends no notice on success', async () => {
    const { service, notices } = build([row('1', 'a.example.com')], jest.fn().mockResolvedValue(true));
    await service.run(now);
    expect(notices.warnFirstFailure).not.toHaveBeenCalled();
    expect(notices.notifyDeactivated).not.toHaveBeenCalled();
  });

  it('treats a lookup that throws or hangs as a failure and keeps going with the next domain', async () => {
    jest.useFakeTimers();
    try {
      const verify = jest
        .fn()
        .mockImplementationOnce(() => new Promise<boolean>(() => undefined))
        .mockResolvedValueOnce(true);
      const { service } = build([row('1', 'slow.example.com'), row('2', 'ok.example.com')], verify);
      const pending = service.run(now);
      await jest.advanceTimersByTimeAsync(9000);
      expect(await pending).toEqual({ checked: 2, failed: 1, deactivated: 0 });
    } finally {
      jest.useRealTimers();
    }
  });
});
