import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { parseSiteSeoSettings } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The per-site IndexNow key: generated on first use, stored in `Site.seoSettings.indexNowKey` and served as
 * `https://<host>/<key>.txt` by the web app. It proves ownership of the host to the search engines and is public
 * by design (it is the content of that file).
 */
@Injectable()
export class IndexNowKeyService {
  constructor(private readonly prisma: PrismaService) {}

  /** The site's key, created on first use; null when the studio has no site. */
  async ensureKey(studioId: string): Promise<string | null> {
    const site = await this.prisma.site.findUnique({ where: { studioId }, select: { id: true, seoSettings: true } });
    if (!site) return null;
    const settings = parseSiteSeoSettings(site.seoSettings);
    if (settings.indexNowKey) return settings.indexNowKey;
    const key = randomBytes(16).toString('hex');
    // Only a site that still has no key is written, so two concurrent first uses cannot disagree.
    const written = await this.prisma.$executeRaw(
      Prisma.sql`UPDATE "sites" SET "seo_settings" = jsonb_set("seo_settings", '{indexNowKey}', to_jsonb(${key}::text)) WHERE "id" = ${site.id}::uuid AND COALESCE("seo_settings"->>'indexNowKey', '') = ''`,
    );
    if (written === 1) return key;
    const again = await this.prisma.site.findUnique({ where: { id: site.id }, select: { seoSettings: true } });
    return parseSiteSeoSettings(again?.seoSettings).indexNowKey;
  }

  /** The key of a site by studio slug, for the public key file; null while none was generated. */
  async keyForSlug(slug: string): Promise<string | null> {
    const studio = await this.prisma.studio.findFirst({ where: { slug, isActive: true }, select: { site: { select: { seoSettings: true } } } });
    return studio?.site ? parseSiteSeoSettings(studio.site.seoSettings).indexNowKey : null;
  }
}

