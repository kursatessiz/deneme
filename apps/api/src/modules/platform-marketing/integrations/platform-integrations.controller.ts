import { Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  ConfigureLeadAdsSchema,
  CreateApiKeySchema,
  CreateEmailSenderDomainSchema,
  CreateSocialConnectionSchema,
  HubUpdateAdConnectionSchema,
  HubUpdateWebhookSchema,
  UpdateSocialConnectionSchema,
  INTEGRATION_ENTRY_HEADER,
  LeadAdFormIdParamSchema,
  UpdateSmsSenderSchema,
  UpsertLeadAdFormMappingSchema,
  type ConfigureLeadAdsInput,
  type CreateApiKeyInput,
  type CreateEmailSenderDomainInput,
  type CreateSocialConnectionInput,
  type HubUpdateAdConnectionInput,
  type HubUpdateWebhookInput,
  type IntegrationEntryPoint,
  type UpdateSocialConnectionInput,
  type UpdateSmsSenderInput,
  type UpsertLeadAdFormMappingInput,
} from '@platform/shared';
import { Platform, PlatformScoped, RequirePlatformPermission } from '../../auth/decorators/platform-scoped.decorator';
import type { PlatformContext } from '../../auth/tenant-context';
import { ZodBody, ZodValidationPipe } from '../../../common/zod-body.pipe';
import { IntegrationHubService } from './integration-hub.service';

/**
 * Which panel the request came from. Only a super admin can be on the
 * admin panel, so anyone else is always recorded as 'marketing' whatever
 * the header says.
 */
function entryPoint(platform: PlatformContext, header: string | undefined): IntegrationEntryPoint {
  return platform.isSuperAdmin && header === 'admin' ? 'admin' : 'marketing';
}

@Controller('platform/integrations')
@PlatformScoped()
@RequirePlatformPermission('platform.integrations.manage')
export class PlatformIntegrationsController {
  constructor(private readonly hub: IntegrationHubService) {}

  @Get()
  summary(@Platform() platform: PlatformContext) {
    return this.hub.summary(platform);
  }

  @Get('social')
  listSocial(@Platform() platform: PlatformContext) {
    return this.hub.listSocialConnections(platform);
  }

  @Post('social')
  createSocial(
    @Platform() platform: PlatformContext,
    @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined,
    @ZodBody(CreateSocialConnectionSchema) body: CreateSocialConnectionInput,
  ) {
    return this.hub.createSocialConnection(platform, entryPoint(platform, via), body);
  }

  @Patch('social/:id')
  updateSocial(
    @Platform() platform: PlatformContext,
    @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(UpdateSocialConnectionSchema) body: UpdateSocialConnectionInput,
  ) {
    return this.hub.updateSocialConnection(platform, entryPoint(platform, via), id, body);
  }

  @Post('social/:id/test')
  @HttpCode(200)
  testSocial(@Platform() platform: PlatformContext, @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.hub.testSocialConnection(platform, entryPoint(platform, via), id);
  }

  @Delete('social/:id')
  removeSocial(@Platform() platform: PlatformContext, @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.hub.removeSocialConnection(platform, entryPoint(platform, via), id);
  }

  @Patch('ads/:id')
  updateAd(
    @Platform() platform: PlatformContext,
    @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(HubUpdateAdConnectionSchema) body: HubUpdateAdConnectionInput,
  ) {
    return this.hub.updateAdConnection(platform, entryPoint(platform, via), id, body);
  }

  @Delete('ads/:id')
  removeAd(@Platform() platform: PlatformContext, @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.hub.removeAdConnection(platform, entryPoint(platform, via), id);
  }

  @Post('api-keys')
  createApiKey(
    @Platform() platform: PlatformContext,
    @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined,
    @ZodBody(CreateApiKeySchema) body: CreateApiKeyInput,
  ) {
    return this.hub.createApiKey(platform, entryPoint(platform, via), body);
  }

  @Delete('api-keys/:id')
  revokeApiKey(@Platform() platform: PlatformContext, @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.hub.revokeApiKey(platform, entryPoint(platform, via), id);
  }

  @Patch('webhooks/:id')
  updateWebhook(
    @Platform() platform: PlatformContext,
    @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(HubUpdateWebhookSchema) body: HubUpdateWebhookInput,
  ) {
    return this.hub.updateWebhook(platform, entryPoint(platform, via), id, body);
  }

  @Delete('webhooks/:id')
  removeWebhook(@Platform() platform: PlatformContext, @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.hub.removeWebhook(platform, entryPoint(platform, via), id);
  }

  @Post('email-domains')
  createEmailDomain(
    @Platform() platform: PlatformContext,
    @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined,
    @ZodBody(CreateEmailSenderDomainSchema) body: CreateEmailSenderDomainInput,
  ) {
    return this.hub.createEmailDomain(platform, entryPoint(platform, via), body);
  }

  @Post('email-domains/:id/check')
  @HttpCode(200)
  checkEmailDomain(@Platform() platform: PlatformContext, @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.hub.checkEmailDomain(platform, entryPoint(platform, via), id);
  }

  @Delete('email-domains/:id')
  removeEmailDomain(@Platform() platform: PlatformContext, @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.hub.removeEmailDomain(platform, entryPoint(platform, via), id);
  }

  // -- Meta Lead Ads (M4c) --

  @Put('lead-ads/:connectionId')
  configureLeadAds(
    @Platform() platform: PlatformContext,
    @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @ZodBody(ConfigureLeadAdsSchema) body: ConfigureLeadAdsInput,
  ) {
    return this.hub.configureLeadAds(platform, entryPoint(platform, via), connectionId, body);
  }

  @Post('lead-ads/:connectionId/check-subscription')
  @HttpCode(200)
  checkLeadAdsSubscription(
    @Platform() platform: PlatformContext,
    @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    return this.hub.checkLeadAdsSubscription(platform, entryPoint(platform, via), connectionId);
  }

  @Put('lead-ads/forms/:formId')
  upsertLeadAdForm(
    @Platform() platform: PlatformContext,
    @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined,
    @Param('formId', new ZodValidationPipe(LeadAdFormIdParamSchema)) formId: string,
    @ZodBody(UpsertLeadAdFormMappingSchema) body: UpsertLeadAdFormMappingInput,
  ) {
    return this.hub.upsertLeadAdForm(platform, entryPoint(platform, via), formId, body);
  }

  @Delete('lead-ads/forms/:formId')
  removeLeadAdForm(
    @Platform() platform: PlatformContext,
    @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined,
    @Param('formId', new ZodValidationPipe(LeadAdFormIdParamSchema)) formId: string,
  ) {
    return this.hub.removeLeadAdForm(platform, entryPoint(platform, via), formId);
  }

  @Get('lead-ads/events')
  leadAdEvents(@Platform() platform: PlatformContext) {
    return this.hub.leadAdEvents(platform);
  }

  @Post('lead-ads/events/:id/retry')
  @HttpCode(200)
  retryLeadAdEvent(@Platform() platform: PlatformContext, @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.hub.retryLeadAdEvent(platform, entryPoint(platform, via), id);
  }

  // -- SMS sender identity (M4c) --

  @Put('sms-sender')
  updateSmsSender(
    @Platform() platform: PlatformContext,
    @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined,
    @ZodBody(UpdateSmsSenderSchema) body: UpdateSmsSenderInput,
  ) {
    return this.hub.updateSmsSender(platform, entryPoint(platform, via), body);
  }
}
