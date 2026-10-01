import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
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
import { AlertHttpClient } from '../error-reporting/alert-sinks/alert-http.client';
import { INDEXNOW_QUEUE, IndexNowQueueService } from './indexnow/indexnow-queue.service';
import { IndexNowProcessor } from './indexnow/indexnow.processor';
import { IndexNowSubmitter } from './indexnow/indexnow-submitter.service';
import { IndexNowKeyService } from './indexnow/indexnow-key.service';
import { IndexNowService } from './indexnow/indexnow.service';

/** Same rule as JobsModule: BullMQ only when REDIS_URL is a real process env var (see jobs.module.ts). */
const redisConfigured = Boolean(process.env.REDIS_URL);

/** Page engine (G2c): Site -> Page -> Block, tenant sites and the platform site, plus blog articles (S2b). See docs/SAYFA_MOTORU.md. */
@Module({
  imports: [AuthModule, ...(redisConfigured ? [BullModule.registerQueue({ name: INDEXNOW_QUEUE })] : [])],
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
    AlertHttpClient,
    IndexNowKeyService,
    IndexNowSubmitter,
    IndexNowQueueService,
    IndexNowService,
    ...(redisConfigured ? [IndexNowProcessor] : []),
  ],
  exports: [SitesService, PagesService, PublicSitesService, SiteCacheService, IndexNowService],
})
export class SitesModule {}
