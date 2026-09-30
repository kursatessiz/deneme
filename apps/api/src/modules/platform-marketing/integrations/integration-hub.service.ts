import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@platform/database';
import {
  MessagingSettingsSchema,
  PLATFORM_WEBHOOK_EVENTS,
  SMS_PROVIDER_KEYS,
  maskSecretPreview,
  parseMessagingSettings,
  resolvePlatformTenantPermissions,
  type ConfigureLeadAdsInput,
  type CreateApiKeyInput,
  type CreateEmailSenderDomainInput,
  type CreateSocialConnectionInput,
  type EmailSenderDomainDTO,
  type HubAutomationDTO,
  type HubMessagingChannelDTO,
  type HubPlatformCardDTO,
  type HubSmsSenderDTO,
  type HubUpdateAdConnectionInput,
  type HubUpdateWebhookInput,
  type IntegrationEntryPoint,
  type IntegrationHubDTO,
  type SocialConnectionDTO,
  type SocialConnectionTestDTO,
  type UpdateSocialConnectionInput,
  type MessagingSettings,
  type UpdateSmsSenderInput,
  type UpsertLeadAdFormMappingInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AdConnectionsService } from '../../ads/connections/ad-connections.service';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { SocialConnectionsService, oauthProviderOf } from '../../social/social-connections.service';
import { LeadAdsAdminService } from '../../lead-ads/lead-ads-admin.service';
import { OAuthConnectService } from '../oauth/oauth-connect.service';
import type { PlatformContext, TenantContext } from '../../auth/tenant-context';
import { DNS_LOOKUP } from './email-domain-dns';
import { EmailDomainService, toEmailDomainDto } from './email-domain.service';

export { DNS_LOOKUP };

type HubKind = 'ads' | 'api_key' | 'webhook' | 'email_domain' | 'social' | 'lead_ads' | 'sms_sender';

/**
 * Integrations hub (docs/PAZARLAMA_MODULU.md 5.1): one service behind
 * /platform/integrations/*, used by both /admin/entegrasyonlar and
 * /pazarlama/entegrasyonlar. It owns no integration table except
 * EmailSenderDomain: ad connections, API keys and webhooks go through their
 * existing services with a tenant context for the platform tenant, so there
 * is no second source of truth. Every write adds an AuditLog row
 * `integration.<kind>.<op>` on the platform tenant with `metadata.via`
 * ('admin' | 'marketing'). No response ever carries a stored secret.
 */
@Injectable()
export class IntegrationHubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly adConnections: AdConnectionsService,
    private readonly apiKeys: ApiKeysService,
    private readonly webhooks: WebhooksService,
    private readonly social: SocialConnectionsService,
    private readonly leadAds: LeadAdsAdminService,
    private readonly oauth: OAuthConnectService,
    private readonly emailDomains: EmailDomainService,
  ) {}

  async summary(platform: PlatformContext): Promise<IntegrationHubDTO> {
    const tenant = this.tenantFor(platform);
    const [ads, socialConnections, keys, hooks, studio, domains, leadAds, oauth, adAuth] = await Promise.all([
      this.adConnections.list(tenant),
      this.social.list(platform.platformStudioId),
      this.apiKeys.list(tenant),
      this.webhooks.list(tenant),
      this.prisma.studio.findUniqueOrThrow({ where: { id: platform.platformStudioId }, select: { messagingSettings: true } }),
      this.prisma.emailSenderDomain.findMany({ where: { studioId: platform.platformStudioId }, orderBy: { createdAt: 'asc' } }),
      this.leadAds.overview(platform.platformStudioId, platform.isSuperAdmin),
      this.oauth.hubOAuth(platform.isSuperAdmin),
      this.prisma.adConnection.findMany({ where: { studioId: platform.platformStudioId }, select: { id: true, oauthProvider: true } }),
    ]);
    const adOAuthProvider = new Map(adAuth.map((a) => [a.id, oauthProviderOf(a.oauthProvider)]));
    return {
      platformStudioId: platform.platformStudioId,
      adConnections: ads.map((a) => ({
        id: a.id,
        platform: a.platform,
        label: a.label,
        status: a.status,
        isTestMode: a.isTestMode,
        credentialPreview: maskSecretPreview(a.credentialLast4),
        lastSyncAt: a.lastSyncAt,
        lastError: a.lastError,
        authMethod: a.authMethod,
        oauthProvider: adOAuthProvider.get(a.id) ?? null,
        tokenExpiresAt: a.tokenExpiresAt,
        reauthRequired: a.status === 'REAUTH_REQUIRED',
      })),
      socialConnections,
      apiKeys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        revokedAt: k.revokedAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
      webhooks: hooks.map((h) => ({
        id: h.id,
        host: safeHost(h.url),
        events: h.events,
        isActive: h.isActive,
        failureCount: h.failureCount,
      })),
      messaging: this.messagingChannels(studio.messagingSettings),
      emailDomains: domains.map((d) => toEmailDomainDto(d, this.emailDomains.sesRegion())),
      platformCards: platform.isSuperAdmin ? await this.platformCards() : [],
      leadAds,
      smsSender: this.smsSender(studio.messagingSettings),
      automation: this.automation(hooks, keys),
      oauth,
    };
  }

  // -- Ad connections (credentials are entered on the ads settings screen) --

  async updateAdConnection(platform: PlatformContext, via: IntegrationEntryPoint, id: string, dto: HubUpdateAdConnectionInput) {
    const updated = await this.adConnections.update(this.tenantFor(platform), platform.userId, id, dto);
    await this.audit(platform, via, 'ads', 'update', id, { fields: Object.keys(dto) });
    return { id: updated.id, label: updated.label, isTestMode: updated.isTestMode, credentialPreview: maskSecretPreview(updated.credentialLast4) };
  }

  async removeAdConnection(platform: PlatformContext, via: IntegrationEntryPoint, id: string) {
    const result = await this.adConnections.remove(this.tenantFor(platform), platform.userId, id);
    await this.audit(platform, via, 'ads', 'delete', id, {});
    return result;
  }

  // -- Social connections (organic publishing, M4b) --

  listSocialConnections(platform: PlatformContext): Promise<SocialConnectionDTO[]> {
    return this.social.list(platform.platformStudioId);
  }

  async createSocialConnection(platform: PlatformContext, via: IntegrationEntryPoint, dto: CreateSocialConnectionInput): Promise<SocialConnectionDTO> {
    const created = await this.social.create(platform.platformStudioId, platform.userId, dto);
    await this.audit(platform, via, 'social', 'create', created.id, { provider: dto.provider, externalId: dto.externalId });
    return created;
  }

  async updateSocialConnection(platform: PlatformContext, via: IntegrationEntryPoint, id: string, dto: UpdateSocialConnectionInput): Promise<SocialConnectionDTO> {
    const updated = await this.social.update(platform.platformStudioId, id, dto);
    await this.audit(platform, via, 'social', 'update', id, { fields: Object.keys(dto), credentialReplaced: dto.credentials !== undefined });
    return updated;
  }

  async removeSocialConnection(platform: PlatformContext, via: IntegrationEntryPoint, id: string): Promise<{ id: string }> {
    const removed = await this.social.remove(platform.platformStudioId, id);
    await this.audit(platform, via, 'social', 'delete', id, { provider: removed.provider, externalId: removed.externalId });
    return { id };
  }

  async testSocialConnection(platform: PlatformContext, via: IntegrationEntryPoint, id: string): Promise<SocialConnectionTestDTO> {
    const result = await this.social.test(platform.platformStudioId, id);
    await this.audit(platform, via, 'social', 'test', id, { ok: result.ok });
    return result;
  }

  // -- API keys (Zapier, Make, n8n) --

  /** The new key's plaintext is returned exactly once, as on the tenant screen; the hub summary only ever shows its prefix. */
  async createApiKey(platform: PlatformContext, via: IntegrationEntryPoint, dto: CreateApiKeyInput) {
    const created = await this.apiKeys.create(this.tenantFor(platform), platform.userId, dto);
    await this.audit(platform, via, 'api_key', 'create', created.id, { name: dto.name, scopes: dto.scopes });
    return created;
  }

  async revokeApiKey(platform: PlatformContext, via: IntegrationEntryPoint, id: string) {
    const revoked = await this.apiKeys.revoke(this.tenantFor(platform), platform.userId, id);
    await this.audit(platform, via, 'api_key', 'revoke', id, {});
    return revoked;
  }

  // -- Webhooks --

  async updateWebhook(platform: PlatformContext, via: IntegrationEntryPoint, id: string, dto: HubUpdateWebhookInput) {
    const updated = await this.webhooks.update(this.tenantFor(platform), platform.userId, id, { isActive: dto.isActive });
    await this.audit(platform, via, 'webhook', 'update', id, { isActive: dto.isActive });
    return { id: updated.id, host: safeHost(updated.url), events: updated.events, isActive: updated.isActive, failureCount: updated.failureCount };
  }

  async removeWebhook(platform: PlatformContext, via: IntegrationEntryPoint, id: string) {
    const result = await this.webhooks.remove(this.tenantFor(platform), platform.userId, id);
    await this.audit(platform, via, 'webhook', 'delete', id, {});
    return result;
  }

  // -- Email sender domains --

  async createEmailDomain(platform: PlatformContext, via: IntegrationEntryPoint, dto: CreateEmailSenderDomainInput): Promise<EmailSenderDomainDTO> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.emailSenderDomain.create({
          data: {
            studioId: platform.platformStudioId,
            domain: dto.domain,
            purpose: dto.purpose,
            mailFromDomain: dto.mailFromDomain ?? null,
            dkimTokens: dto.dkimTokens as Prisma.InputJsonValue,
            dailyCap: dto.dailyCap ?? null,
          },
        });
        await this.auditTx(tx, platform, via, 'email_domain', 'create', created.id, { domain: dto.domain, purpose: dto.purpose });
        return created;
      });
      return toEmailDomainDto(row, this.emailDomains.sesRegion());
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bu alan adı zaten ekli');
      }
      throw err;
    }
  }

  /**
   * Looks the records up now and stores the result; a commercial send may use the domain once SPF, DKIM and DMARC are all VALID.
   * M5: DKIM (and the identity verification status) come from SES when credentials are configured.
   */
  async checkEmailDomain(platform: PlatformContext, via: IntegrationEntryPoint, id: string): Promise<EmailSenderDomainDTO> {
    const domain = await this.findDomain(platform, id);
    const outcome = await this.emailDomains.check(domain, (tx, result) => this.auditTx(tx, platform, via, 'email_domain', 'check', domain.id, { spf: result.spf, dkim: result.dkim, dmarc: result.dmarc }));
    return toEmailDomainDto(outcome.row, this.emailDomains.sesRegion(), outcome.records);
  }

  async removeEmailDomain(platform: PlatformContext, via: IntegrationEntryPoint, id: string): Promise<{ id: string }> {
    const domain = await this.findDomain(platform, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.emailSenderDomain.delete({ where: { id: domain.id } });
      await this.auditTx(tx, platform, via, 'email_domain', 'delete', domain.id, { domain: domain.domain });
    });
    return { id: domain.id };
  }

  // -- Meta Lead Ads (M4c) --

  async configureLeadAds(platform: PlatformContext, via: IntegrationEntryPoint, connectionId: string, dto: ConfigureLeadAdsInput) {
    const result = await this.leadAds.configure(platform.platformStudioId, connectionId, dto);
    await this.audit(platform, via, 'lead_ads', 'configure', connectionId, { pageId: result.pageId, appSecretSet: dto.appSecret !== undefined });
    return result;
  }

  async checkLeadAdsSubscription(platform: PlatformContext, via: IntegrationEntryPoint, connectionId: string) {
    const result = await this.leadAds.checkSubscription(platform.platformStudioId, connectionId);
    await this.audit(platform, via, 'lead_ads', 'check_subscription', connectionId, { subscribed: result.subscribed });
    return result;
  }

  async upsertLeadAdForm(platform: PlatformContext, via: IntegrationEntryPoint, formId: string, dto: UpsertLeadAdFormMappingInput) {
    const result = await this.leadAds.upsertForm(platform.platformStudioId, platform.userId, formId, dto);
    await this.audit(platform, via, 'lead_ads', 'form_upsert', formId, { questions: Object.keys(dto.mapping).length, consentQuestion: dto.consentQuestionKey !== null });
    return result;
  }

  async removeLeadAdForm(platform: PlatformContext, via: IntegrationEntryPoint, formId: string) {
    const result = await this.leadAds.removeForm(platform.platformStudioId, formId);
    await this.audit(platform, via, 'lead_ads', 'form_delete', formId, {});
    return result;
  }

  leadAdEvents(platform: PlatformContext) {
    return this.leadAds.events(platform.platformStudioId);
  }

  async retryLeadAdEvent(platform: PlatformContext, via: IntegrationEntryPoint, id: string) {
    const result = await this.leadAds.retryEvent(platform.platformStudioId, id);
    await this.audit(platform, via, 'lead_ads', 'event_retry', id, {});
    return result;
  }

  // -- SMS sender identity (M4c): registration status entered by hand --

  async updateSmsSender(platform: PlatformContext, via: IntegrationEntryPoint, dto: UpdateSmsSenderInput): Promise<HubSmsSenderDTO> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: platform.platformStudioId }, select: { messagingSettings: true } });
    const parsed = MessagingSettingsSchema.safeParse(studio.messagingSettings ?? {});
    const current: MessagingSettings = parsed.success ? parsed.data : {};
    const now = new Date().toISOString();
    const next: MessagingSettings =
      dto.kind === 'SENDER_ID'
        ? { ...current, smsSenderRegistrations: { ...(current.smsSenderRegistrations ?? {}), [dto.provider]: { senderId: dto.senderId ?? null, status: dto.status, updatedAt: now } } }
        : { ...current, twilio10dlc: { brandStatus: dto.brandStatus, campaignStatus: dto.campaignStatus, updatedAt: now } };
    await this.prisma.studio.update({ where: { id: platform.platformStudioId }, data: { messagingSettings: next as Prisma.InputJsonValue } });
    await this.audit(
      platform,
      via,
      'sms_sender',
      dto.kind === 'SENDER_ID' ? 'update' : 'update_10dlc',
      dto.kind === 'SENDER_ID' ? dto.provider : 'TWILIO',
      dto.kind === 'SENDER_ID' ? { provider: dto.provider, status: dto.status } : { brandStatus: dto.brandStatus, campaignStatus: dto.campaignStatus },
    );
    return this.smsSender(next);
  }

  // -- Helpers --

  private smsSender(raw: unknown): HubSmsSenderDTO {
    const parsed = MessagingSettingsSchema.safeParse(raw ?? {});
    const settings: MessagingSettings = parsed.success ? parsed.data : {};
    const envProvider = this.config.get<string>('SMS_PROVIDER', 'MOCK');
    const active = settings.smsProvider ?? ((SMS_PROVIDER_KEYS as readonly string[]).includes(envProvider) ? envProvider : null);
    return {
      providers: SMS_PROVIDER_KEYS.map((provider) => {
        const registration = settings.smsSenderRegistrations?.[provider];
        return {
          provider,
          // The Netgsm header of the environment is the sender id in use until one is recorded here.
          senderId: registration?.senderId ?? (provider === 'NETGSM' ? (this.config.get<string>('NETGSM_HEADER') ?? null) : null),
          status: registration?.status ?? 'NOT_STARTED',
          updatedAt: registration?.updatedAt ?? null,
          active: provider === active,
        };
      }),
      twilio10dlc: settings.twilio10dlc
        ? { brandStatus: settings.twilio10dlc.brandStatus, campaignStatus: settings.twilio10dlc.campaignStatus, updatedAt: settings.twilio10dlc.updatedAt ?? null }
        : null,
    };
  }

  private automation(hooks: { isActive: boolean; events: string[] }[], keys: { revokedAt: Date | null; expiresAt?: Date | null; scopes: string[] }[]): HubAutomationDTO {
    return {
      platformEvents: PLATFORM_WEBHOOK_EVENTS.map((event) => ({ event, activeSubscriptions: hooks.filter((h) => h.isActive && h.events.includes(event)).length })),
      crmWriteKeyCount: keys.filter((k) => !k.revokedAt && k.scopes.includes('crm.write')).length,
    };
  }

  /**
   * Tenant context for the platform tenant, bounded by the caller's derived
   * tenant permissions (super admins: everything, as StudioTenantGuard
   * gives them). The existing services still check studio ownership.
   */
  private tenantFor(platform: PlatformContext): TenantContext {
    return {
      studioId: platform.platformStudioId,
      membershipId: null,
      isOwner: false,
      isSuperAdmin: platform.isSuperAdmin,
      permissions: new Set(resolvePlatformTenantPermissions([...platform.permissions])),
      memberProfileId: null,
      trainerProfileId: null,
      branchIds: null,
    };
  }

  private messagingChannels(raw: unknown): HubMessagingChannelDTO[] {
    const settings = parseMessagingSettings(raw);
    const envSms = this.config.get<string>('SMS_PROVIDER', 'MOCK');
    const smsProvider = settings.smsProvider ?? (envSms && envSms !== 'MOCK' ? envSms : null);
    const sesConfigured = Boolean(this.config.get<string>('SES_REGION') && this.config.get<string>('SES_FROM_ADDRESS'));
    const waConfigured = Boolean(this.config.get<string>('WHATSAPP_ACCESS_TOKEN') && this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID'));
    return [
      { channel: 'EMAIL', provider: sesConfigured ? 'SES' : null, configured: sesConfigured },
      { channel: 'SMS', provider: smsProvider, configured: smsProvider !== null },
      { channel: 'WHATSAPP', provider: waConfigured ? 'WHATSAPP_CLOUD' : null, configured: waConfigured },
    ];
  }

  private async platformCards(): Promise<HubPlatformCardDTO[]> {
    const ai = await this.prisma.aiSettings.findUnique({ where: { id: 'platform' }, select: { encryptedApiKey: true } });
    const payment = this.config.get<string>('PAYMENT_PROVIDER', 'MOCK');
    const sms = this.config.get<string>('SMS_PROVIDER', 'MOCK');
    return [
      { key: 'ai', configured: Boolean(ai?.encryptedApiKey || this.config.get<string>('ANTHROPIC_API_KEY')), href: '/admin/ai' },
      { key: 'smsBalance', configured: Boolean(sms && sms !== 'MOCK'), href: '/admin/health' },
      { key: 'payments', configured: Boolean(payment && payment !== 'MOCK'), href: '/admin/health' },
    ];
  }

  private async findDomain(platform: PlatformContext, id: string) {
    const domain = await this.prisma.emailSenderDomain.findFirst({ where: { id, studioId: platform.platformStudioId } });
    if (!domain) throw new NotFoundException('Alan adı bulunamadı');
    return domain;
  }

  private async audit(platform: PlatformContext, via: IntegrationEntryPoint, kind: HubKind, op: string, entityId: string, metadata: Record<string, unknown>) {
    await this.auditTx(this.prisma, platform, via, kind, op, entityId, metadata);
  }

  private async auditTx(
    tx: Prisma.TransactionClient | PrismaService,
    platform: PlatformContext,
    via: IntegrationEntryPoint,
    kind: HubKind,
    op: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    await tx.auditLog.create({
      data: {
        studioId: platform.platformStudioId,
        userId: platform.userId,
        action: `integration.${kind}.${op}`,
        entityType: 'integration',
        entityId,
        metadata: { ...metadata, via } as Prisma.InputJsonValue,
      },
    });
  }
}

/** Host only: a webhook URL's path can carry a hook token (Zapier, Make). */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
