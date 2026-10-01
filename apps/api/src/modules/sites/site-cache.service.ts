import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { siteCacheTag } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

const REQUEST_TIMEOUT_MS = 3000;

/**
 * Asks the web app to drop its cached pages of one site (docs/SEO.md "ISR"). Called after a change to a
 * site's public content: page and article publish and unpublish, deleting published content, site settings.
 * `POST {WEB_INTERNAL_URL}/api/revalidate` with `{ tags: ["site:<slug>"] }` and the shared secret
 * `REVALIDATE_SECRET`. Best effort: it never throws and never blocks a request on the web app being up; when
 * either variable is unset (local development, the e2e suite) it does nothing and pages refresh by their
 * 300 second window.
 */
@Injectable()
export class SiteCacheService {
  private readonly logger = new Logger(SiteCacheService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** The studio's slug is the cache key, so the studio is looked up here and callers only need its id. */
  async purgeStudio(studioId: string): Promise<void> {
    try {
      const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { slug: true } });
      if (studio) await this.purgeSlug(studio.slug);
    } catch (err) {
      this.logger.warn(`Site cache purge failed for studio ${studioId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async purgeSlug(slug: string): Promise<void> {
    const baseUrl = this.config.get<string>('WEB_INTERNAL_URL');
    const secret = this.config.get<string>('REVALIDATE_SECRET');
    if (!baseUrl || !secret) return;
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/revalidate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
        body: JSON.stringify({ tags: [siteCacheTag(slug)] }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) this.logger.warn(`Site cache purge for ${slug} answered ${res.status}`);
    } catch (err) {
      this.logger.warn(`Site cache purge for ${slug} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
