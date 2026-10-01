import { Injectable, Logger } from '@nestjs/common';
import { INDEXNOW_ENDPOINT, SEO_INDEXNOW_FLAG, buildIndexNowPayload } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertHttpClient } from '../../error-reporting/alert-sinks/alert-http.client';
import { resolveFeatureForStudio } from '../../billing/add-ons/effective-feature';
import { canonicalOriginOf } from '../canonical-origin';
import { IndexNowKeyService } from './indexnow-key.service';
import type { IndexNowJobData } from './indexnow-queue.service';

export type IndexNowOutcome = 'sent' | 'skipped_test' | 'skipped_flag_off' | 'skipped_no_payload' | 'rejected';

/**
 * Posts one IndexNow notification (`https://api.indexnow.org/indexnow`) through the shared HTTP egress client
 * (https only, fixed host allow-list, SSRF-guarded, 5 second timeout, no redirects) and records the result in the
 * audit log. Skipped in the test environment, and when the flag was turned off while the job waited. A rate
 * limit or server error throws so the queue retries; any other refusal is logged and not retried.
 */
@Injectable()
export class IndexNowSubmitter {
  private readonly logger = new Logger(IndexNowSubmitter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: AlertHttpClient,
    private readonly keys: IndexNowKeyService,
  ) {}

  async submit(job: IndexNowJobData): Promise<IndexNowOutcome> {
    if (process.env.NODE_ENV === 'test') return 'skipped_test';
    if (!(await resolveFeatureForStudio(this.prisma, job.studioId, SEO_INDEXNOW_FLAG))) return 'skipped_flag_off';

    const studio = await this.prisma.studio.findUnique({
      where: { id: job.studioId },
      select: { slug: true, isPlatform: true, site: { select: { primaryDomain: true, domains: { select: { domain: true, status: true, verifiedAt: true } } } } },
    });
    if (!studio?.site) return 'skipped_no_payload';
    const key = await this.keys.ensureKey(job.studioId);
    const origin = canonicalOriginOf({ isPlatform: studio.isPlatform, slug: studio.slug, primaryDomain: studio.site.primaryDomain, domains: studio.site.domains });
    const payload = key ? buildIndexNowPayload({ origin, key, urls: job.urls }) : null;
    if (!payload) return 'skipped_no_payload';

    const res = await this.http.post({
      url: INDEXNOW_ENDPOINT,
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      allowedHosts: ['api.indexnow.org'],
    });
    const accepted = res.status === 200 || res.status === 202;
    await this.prisma.auditLog.create({
      data: {
        studioId: job.studioId,
        userId: null,
        action: accepted ? 'indexnow.submitted' : 'indexnow.rejected',
        entityType: 'Site',
        entityId: null,
        metadata: { host: payload.host, urlCount: payload.urlList.length, status: res.status },
      },
    });
    if (accepted) return 'sent';
    // 429 and 5xx are worth retrying; a 4xx refusal (bad key, bad URL) will not change.
    if (res.status === 429 || res.status >= 500) throw new Error(`IndexNow answered ${res.status}`);
    this.logger.warn(`IndexNow refused ${payload.host}: ${res.status}`);
    return 'rejected';
  }
}
