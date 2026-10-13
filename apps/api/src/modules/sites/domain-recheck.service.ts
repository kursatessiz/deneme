import { Injectable, Logger } from '@nestjs/common';
import { DOMAIN_RECHECK_FAILURE_LIMIT } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DnsVerificationService } from './dns.service';
import { DomainNoticeService } from './domain-notice.service';
import { SiteCacheService } from './site-cache.service';
import { platformCnameTarget } from './sites.service';

/** Domains re-checked per heartbeat run; the rest wait for the next one (the heartbeat runs every 15 minutes). */
export const DOMAIN_RECHECK_BATCH = 50;
/** A domain is checked again once its last check is older than this (daily; slightly under 24 h so a 15 minute heartbeat never skips a day). */
export const DOMAIN_RECHECK_INTERVAL_MS = 23 * 60 * 60 * 1000;
/** Hard ceiling per lookup, so one slow resolver cannot stall the heartbeat. */
export const DOMAIN_RECHECK_TIMEOUT_MS = 8000;

export interface DomainRecheckResult {
  checked: number;
  failed: number;
  deactivated: number;
}

/**
 * Heartbeat step: re-verifies VERIFIED custom domains once a day with the same DNS check as the verify
 * action. A failure is recorded (`lastFailureAt`, `consecutiveFailures`); the Nth consecutive failure
 * (DOMAIN_RECHECK_FAILURE_LIMIT) sets the domain to FAILED, which stops the public site, the Caddy "ask" approval
 * and the canonical origin from using it, and purges the web caches of the host and the site. A success resets
 * the counter. A FAILED domain is not re-checked: the tenant restores it with the normal verify action.
 */
@Injectable()
export class DomainRecheckService {
  private readonly logger = new Logger(DomainRecheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dns: DnsVerificationService,
    private readonly siteCache: SiteCacheService,
    private readonly notices: DomainNoticeService,
  ) {}

  async run(now: Date): Promise<DomainRecheckResult> {
    const due = await this.prisma.siteDomain.findMany({
      where: {
        status: 'VERIFIED',
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - DOMAIN_RECHECK_INTERVAL_MS) } }],
      },
      orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: DOMAIN_RECHECK_BATCH,
      select: { id: true, domain: true, verificationToken: true, site: { select: { studioId: true, studio: { select: { isPlatform: true } } } } },
    });
    const result: DomainRecheckResult = { checked: 0, failed: 0, deactivated: 0 };
    for (const row of due) {
      result.checked += 1;
      let ok = false;
      try {
        ok = await withTimeout(this.dns.verify(row.domain, row.verificationToken, platformCnameTarget()), DOMAIN_RECHECK_TIMEOUT_MS);
      } catch (err) {
        this.logger.warn(`Domain re-check of ${row.domain} did not finish: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (ok) {
        await this.prisma.siteDomain.updateMany({ where: { id: row.id, status: 'VERIFIED' }, data: { lastCheckedAt: now, consecutiveFailures: 0 } });
        continue;
      }
      result.failed += 1;
      const updated = await this.prisma.siteDomain.update({
        where: { id: row.id },
        data: { lastCheckedAt: now, lastFailureAt: now, consecutiveFailures: { increment: 1 } },
        select: { consecutiveFailures: true },
      });
      const target = { domainId: row.id, domain: row.domain, studioId: row.site.studioId, isPlatformStudio: row.site.studio.isPlatform, eventAt: now };
      if (updated.consecutiveFailures < DOMAIN_RECHECK_FAILURE_LIMIT) {
        // The 0 -> 1 transition happens once per streak (a success resets the counter), so the warning goes out once.
        if (updated.consecutiveFailures === 1) await this.notices.warnFirstFailure(target, DOMAIN_RECHECK_FAILURE_LIMIT - 1, platformCnameTarget());
        continue;
      }
      const flipped = await this.prisma.siteDomain.updateMany({ where: { id: row.id, status: 'VERIFIED' }, data: { status: 'FAILED', verifiedAt: null } });
      if (flipped.count === 0) continue;
      result.deactivated += 1;
      this.logger.warn(`Custom domain ${row.domain} deactivated after ${updated.consecutiveFailures} failed daily checks`);
      await this.siteCache.purgeDomain(row.domain, row.site.studioId);
      await this.notices.notifyDeactivated(target);
    }
    return result;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
