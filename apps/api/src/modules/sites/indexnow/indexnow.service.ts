import { Injectable, Logger } from '@nestjs/common';
import { SEO_INDEXNOW_FLAG, indexNowUrlsForArticle, indexNowUrlsForPage } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveFeatureForStudio } from '../../billing/add-ons/effective-feature';
import { canonicalOriginOf } from '../canonical-origin';
import { IndexNowQueueService } from './indexnow-queue.service';

/**
 * Tells search engines about published and unpublished pages and articles (docs/SEO.md "IndexNow"). Gated by the
 * `seo.indexnow` feature flag (default off, per tenant like any other flag). The URLs are those of every locale
 * variant of the changed page or article (an unpublished one tells the engines to re-check and drop it) and are
 * queued as one job per change. Best effort: it never throws and never delays the request that triggered it.
 */
@Injectable()
export class IndexNowService {
  private readonly logger = new Logger(IndexNowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: IndexNowQueueService,
  ) {}

  /** A page was published, rolled back to a version, or unpublished. */
  async notifyPage(studioId: string, pageId: string): Promise<void> {
    await this.run(studioId, async (origin, siteId) => {
      const variants = await this.prisma.pageLocale.findMany({ where: { pageId, siteId }, select: { locale: true, slug: true } });
      return indexNowUrlsForPage(origin, variants);
    });
  }

  /** An article was published or archived. */
  async notifyArticle(studioId: string, articleId: string): Promise<void> {
    await this.run(studioId, async (origin, siteId) => {
      const variants = await this.prisma.articleLocale.findMany({ where: { articleId, siteId }, select: { locale: true, slug: true } });
      return indexNowUrlsForArticle(origin, variants);
    });
  }

  private async run(studioId: string, urls: (origin: string, siteId: string) => Promise<string[]>): Promise<void> {
    try {
      if (!(await resolveFeatureForStudio(this.prisma, studioId, SEO_INDEXNOW_FLAG))) return;
      const studio = await this.prisma.studio.findUnique({
        where: { id: studioId },
        select: { slug: true, isPlatform: true, site: { select: { id: true, primaryDomain: true, domains: { select: { domain: true, status: true, verifiedAt: true } } } } },
      });
      if (!studio?.site) return;
      const origin = canonicalOriginOf({ isPlatform: studio.isPlatform, slug: studio.slug, primaryDomain: studio.site.primaryDomain, domains: studio.site.domains });
      const list = await urls(origin, studio.site.id);
      if (list.length === 0) return;
      await this.queue.enqueue({ studioId, urls: list });
    } catch (err) {
      this.logger.warn(`IndexNow notification failed for studio ${studioId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
