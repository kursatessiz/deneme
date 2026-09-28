import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  UpdateSiteSchema,
  AddSiteDomainSchema,
  CreatePageSchema,
  UpsertPageLocaleSchema,
  ApproveLegalSchema,
  ReorderBlocksSchema,
  CreateSectorLandingWizardSchema,
  type UpdateSiteInput,
  type AddSiteDomainInput,
  type CreatePageInput,
  type UpsertPageLocaleInput,
  type ApproveLegalInput,
  type CreateSectorLandingWizardInput,
} from '@platform/shared';
import { z } from 'zod';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { Tenant, CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { TenantContext, AuthUser } from '../auth/tenant-context';
import { SitesService } from './sites.service';
import { PagesService } from './pages.service';
import { UpsertBlockSchema } from '@platform/shared';
import type { UpsertBlockInput } from '@platform/shared';

const BlocksArraySchema = z.array(UpsertBlockSchema).max(100);

/**
 * A studio's own site (docs/SAYFA_MOTORU.md). Used both by tenant staff
 * (permission `site.manage` / `site.view`) and, for the platform's own
 * marketing site, by the super admin acting on the platform studio via the
 * same route (StudioTenantGuard gives a super-admin every permission on
 * any studioId).
 */
@Controller('sites/studio/:studioId')
@StudioScoped()
export class SitesTenantController {
  constructor(
    private readonly sites: SitesService,
    private readonly pages: PagesService,
  ) {}

  @Get()
  @RequirePermission('site.view')
  async getSite(@Tenant() tenant: TenantContext) {
    return this.sites.ensureSite(tenant.studioId);
  }

  @Patch()
  @RequirePermission('site.manage')
  async updateSite(@Tenant() tenant: TenantContext, @ZodBody(UpdateSiteSchema) body: UpdateSiteInput) {
    await this.sites.ensureSite(tenant.studioId);
    return this.sites.updateSite(tenant.studioId, body);
  }

  @Post('domains')
  @RequirePermission('site.manage')
  async addDomain(@Tenant() tenant: TenantContext, @ZodBody(AddSiteDomainSchema) body: AddSiteDomainInput) {
    await this.sites.ensureSite(tenant.studioId);
    const domain = await this.sites.addDomain(tenant.studioId, body.domain);
    return { ...domain, instructions: this.sites.dnsInstructions(domain.domain, domain.verificationToken) };
  }

  @Post('domains/:domainId/verify')
  @RequirePermission('site.manage')
  async verifyDomain(@Tenant() tenant: TenantContext, @Param('domainId', ParseUUIDPipe) domainId: string) {
    return this.sites.verifyDomain(tenant.studioId, domainId);
  }

  @Delete('domains/:domainId')
  @RequirePermission('site.manage')
  async removeDomain(@Tenant() tenant: TenantContext, @Param('domainId', ParseUUIDPipe) domainId: string) {
    await this.sites.removeDomain(tenant.studioId, domainId);
    return { deleted: true };
  }

  @Get('pages')
  @RequirePermission('site.view')
  async listPages(@Tenant() tenant: TenantContext) {
    await this.sites.ensureSite(tenant.studioId);
    return { items: await this.pages.listPages(tenant.studioId) };
  }

  @Post('pages')
  @RequirePermission('site.manage')
  async createPage(@Tenant() tenant: TenantContext, @ZodBody(CreatePageSchema) body: CreatePageInput) {
    await this.sites.ensureSite(tenant.studioId);
    return this.pages.createPage(tenant.studioId, body);
  }

  @Post('pages/wizard')
  @RequirePermission('site.manage')
  async wizard(@Tenant() tenant: TenantContext, @ZodBody(CreateSectorLandingWizardSchema) body: CreateSectorLandingWizardInput) {
    await this.sites.ensureSite(tenant.studioId);
    return this.pages.createSectorLandingWizard(tenant.studioId, body);
  }

  @Get('pages/:pageId')
  @RequirePermission('site.view')
  async getPage(@Tenant() tenant: TenantContext, @Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.pages.getPageDetail(tenant.studioId, pageId);
  }

  @Delete('pages/:pageId')
  @RequirePermission('site.manage')
  async deletePage(@Tenant() tenant: TenantContext, @Param('pageId', ParseUUIDPipe) pageId: string) {
    await this.pages.deletePage(tenant.studioId, pageId);
    return { deleted: true };
  }

  @Put('pages/:pageId/locales/:locale')
  @RequirePermission('site.manage')
  async upsertLocale(
    @Tenant() tenant: TenantContext,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('locale') locale: string,
    @ZodBody(UpsertPageLocaleSchema) body: UpsertPageLocaleInput,
  ) {
    return this.pages.upsertLocale(tenant.studioId, pageId, locale, body);
  }

  @Delete('pages/:pageId/locales/:locale')
  @RequirePermission('site.manage')
  async removeLocale(@Tenant() tenant: TenantContext, @Param('pageId', ParseUUIDPipe) pageId: string, @Param('locale') locale: string) {
    await this.pages.removeLocale(tenant.studioId, pageId, locale);
    return { deleted: true };
  }

  @Patch('pages/:pageId/locales/:locale/legal-approval')
  @RequirePermission('site.manage')
  async setLegalApproval(
    @Tenant() tenant: TenantContext,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('locale') locale: string,
    @ZodBody(ApproveLegalSchema) body: ApproveLegalInput,
  ) {
    return this.pages.setLegalApproval(tenant.studioId, pageId, locale, body.approved);
  }

  @Put('pages/:pageId/blocks')
  @RequirePermission('site.manage')
  async replaceBlocks(@Tenant() tenant: TenantContext, @Param('pageId', ParseUUIDPipe) pageId: string, @ZodBody(BlocksArraySchema) body: UpsertBlockInput[]) {
    return { items: await this.pages.replaceBlocks(tenant.studioId, pageId, body) };
  }

  @Post('pages/:pageId/publish')
  @RequirePermission('site.manage')
  async publish(@Tenant() tenant: TenantContext, @Param('pageId', ParseUUIDPipe) pageId: string, @CurrentUser() user: AuthUser) {
    return this.pages.publish(tenant.studioId, pageId, user.id);
  }

  @Post('pages/:pageId/unpublish')
  @RequirePermission('site.manage')
  async unpublish(@Tenant() tenant: TenantContext, @Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.pages.unpublish(tenant.studioId, pageId);
  }

  @Get('pages/:pageId/versions')
  @RequirePermission('site.view')
  async listVersions(@Tenant() tenant: TenantContext, @Param('pageId', ParseUUIDPipe) pageId: string) {
    return { items: await this.pages.listVersions(tenant.studioId, pageId) };
  }

  @Post('pages/:pageId/versions/:versionId/rollback')
  @RequirePermission('site.manage')
  async rollback(
    @Tenant() tenant: TenantContext,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pages.rollback(tenant.studioId, pageId, versionId, user.id);
  }
}
