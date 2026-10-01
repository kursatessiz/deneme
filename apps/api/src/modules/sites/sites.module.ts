import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SitesService } from './sites.service';
import { PagesService } from './pages.service';
import { CompanyInfoService } from './company-info.service';
import { PublicSitesService } from './public-sites.service';
import { DnsVerificationService } from './dns.service';
import { SitesTenantController } from './sites-tenant.controller';
import { CompanyInfoController } from './company-info.controller';
import { PublicSitesController } from './public-sites.controller';
import { SitesFeedRateLimitGuard, SitesPublicRateLimitGuard } from './sites-rate-limit.guard';
import { ArticlesService } from './articles.service';
import { PublicArticlesService } from './public-articles.service';
import { ArticlesFeedCache } from './articles-feed-cache.service';
import { ArticlesTenantController } from './articles-tenant.controller';
import { PublicArticlesController } from './public-articles.controller';
import { SiteCacheService } from './site-cache.service';

/** Page engine (G2c): Site -> Page -> Block, tenant sites and the platform site, plus blog articles (S2b). See docs/SAYFA_MOTORU.md. */
@Module({
  imports: [AuthModule],
  controllers: [SitesTenantController, ArticlesTenantController, CompanyInfoController, PublicSitesController, PublicArticlesController],
  providers: [
    SitesService,
    PagesService,
    CompanyInfoService,
    PublicSitesService,
    DnsVerificationService,
    SitesPublicRateLimitGuard,
    SitesFeedRateLimitGuard,
    ArticlesService,
    PublicArticlesService,
    ArticlesFeedCache,
    SiteCacheService,
  ],
  exports: [SitesService, PagesService, PublicSitesService, SiteCacheService],
})
export class SitesModule {}
