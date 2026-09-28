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
import { SitesPublicRateLimitGuard } from './sites-rate-limit.guard';

/** Page engine (G2c): Site -> Page -> Block, tenant sites and the platform site. See docs/SAYFA_MOTORU.md. */
@Module({
  imports: [AuthModule],
  controllers: [SitesTenantController, CompanyInfoController, PublicSitesController],
  providers: [SitesService, PagesService, CompanyInfoService, PublicSitesService, DnsVerificationService, SitesPublicRateLimitGuard],
  exports: [SitesService, PagesService, PublicSitesService],
})
export class SitesModule {}
