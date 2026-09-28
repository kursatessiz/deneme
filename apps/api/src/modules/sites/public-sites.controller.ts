import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { PublicSitesService } from './public-sites.service';
import { SitesService } from './sites.service';
import { SitesPublicRateLimitGuard } from './sites-rate-limit.guard';

/**
 * Unauthenticated read routes the web app's rendering layer and Caddy call.
 * See docs/SAYFA_MOTORU.md.
 */
@Controller()
export class PublicSitesController {
  constructor(
    private readonly publicSites: PublicSitesService,
    private readonly sites: SitesService,
  ) {}

  /** Web middleware: which site does this Host header belong to. */
  @Get('public/sites/resolve')
  async resolve(@Query('host') host: string) {
    if (!host) throw new NotFoundException('Site bulunamadı');
    const resolved = await this.publicSites.resolveHost(host);
    if (!resolved) throw new NotFoundException('Site bulunamadı');
    return resolved;
  }

  /** One published page, for a locale, by its slug. Unpublished or missing locale is a 404. */
  @Get('public/sites/:studioSlug/pages')
  async getPage(@Param('studioSlug') studioSlug: string, @Query('locale') locale: string, @Query('slug') slug: string) {
    if (!locale || slug === undefined) throw new NotFoundException('Sayfa bulunamadı');
    return this.publicSites.getPage(studioSlug, locale, slug || '');
  }

  @Get('public/sites/:studioSlug/sitemap-entries')
  async sitemapEntries(@Param('studioSlug') studioSlug: string) {
    return { items: await this.publicSites.sitemapEntries(studioSlug) };
  }

  /**
   * Caddy on-demand TLS "ask" endpoint: 200 only for a verified custom
   * domain of an active studio, anything else 404 (never reveal which
   * domains exist or their state beyond verified/not).
   */
  @Get('public/domains/ask')
  @UseGuards(SitesPublicRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async ask(@Query('domain') domain: string) {
    if (!domain) throw new NotFoundException();
    const ok = await this.sites.isVerifiedActiveDomain(domain.toLowerCase());
    if (!ok) throw new NotFoundException();
    return { ok: true };
  }
}
