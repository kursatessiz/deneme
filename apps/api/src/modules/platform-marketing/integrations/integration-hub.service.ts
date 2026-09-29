import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@platform/database';
import {
  maskSecretPreview,
  parseMessagingSettings,
  resolvePlatformTenantPermissions,
  type CreateApiKeyInput,
  type CreateEmailSenderDomainInput,
  type CreateSocialConnectionInput,
  type DnsRecordStatus,
  type EmailDomainPurpose,
  type EmailSenderDomainDTO,
  type HubMessagingChannelDTO,
  type HubPlatformCardDTO,
  type HubUpdateAdConnectionInput,
  type HubUpdateWebhookInput,
  type IntegrationEntryPoint,
  type IntegrationHubDTO,
  type SocialConnectionDTO,
  type SocialConnectionTestDTO,
  type UpdateSocialConnectionInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AdConnectionsService } from '../../ads/connections/ad-connections.service';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { SocialConnectionsService } from '../../social/social-connections.service';
import type { PlatformContext, TenantContext } from '../../auth/tenant-context';
import { checkEmailDomainDns, expectedEmailDomainRecords, type DnsLookup } from './email-domain-dns';

export const DNS_LOOKUP = Symbol('DNS_LOOKUP');

type HubKind = 'ads' | 'api_key' | 'webhook' | 'email_domain' | 'social';

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
    @Inject(DNS_LOOKUP) private readonly dns: DnsLookup,
  ) {}

  async summary(platform: PlatformContext): Promise<IntegrationHubDTO> {
    const tenant = this.tenantFor(platform);
    const [ads, socialConnections, keys, hooks, studio, domains] = await Promise.all([
      this.adConnections.list(tenant),
      this.social.list(platform.platformStudioId),
      this.apiKeys.list(tenant),
      this.webhooks.list(tenant),
      this.prisma.studio.findUniqueOrThrow({ where: { id: platform.platformStudioId }, select: { messagingSettings: true } }),
      this.prisma.emailSenderDomain.findMany({ where: { studioId: platform.platformStudioId }, orderBy: { createdAt: 'asc' } }),
    ]);
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
      emailDomains: domains.map((d) => this.toDomainDto(d)),
      platformCards: platform.isSuperAdmin ? await this.platformCards() : [],
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
      return this.toDomainDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bu alan adı zaten ekli');
      }
      throw err;
    }
  }

  /** Looks the records up now and stores the result; a commercial send may use the domain once SPF, DKIM and DMARC are all VALID. */
  async checkEmailDomain(platform: PlatformContext, via: IntegrationEntryPoint, id: string): Promise<EmailSenderDomainDTO> {
    const domain = await this.findDomain(platform, id);
    const result = await checkEmailDomainDns(this.domainConfig(domain), this.dns);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.emailSenderDomain.update({
        where: { id: domain.id },
        data: {
          spfStatus: result.spfStatus,
          dkimStatus: result.dkimStatus,
          dmarcStatus: result.dmarcStatus,
          dmarcPolicy: result.dmarcPolicy,
          lastCheckedAt: new Date(),
          lastError: result.error,
          // M3d: the first time SPF, DKIM and DMARC are all valid starts the warm-up plan (marketing_settings.email_warmup_plan).
          ...(!domain.warmupStartedAt && result.spfStatus === 'VALID' && result.dkimStatus === 'VALID' && result.dmarcStatus === 'VALID' ? { warmupStartedAt: new Date() } : {}),
        },
      });
      await this.auditTx(tx, platform, via, 'email_domain', 'check', domain.id, {
        spf: result.spfStatus,
        dkim: result.dkimStatus,
        dmarc: result.dmarcStatus,
      });
      return updated;
    });
    return this.toDomainDto(row, result.records);
  }

  async removeEmailDomain(platform: PlatformContext, via: IntegrationEntryPoint, id: string): Promise<{ id: string }> {
    const domain = await this.findDomain(platform, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.emailSenderDomain.delete({ where: { id: domain.id } });
      await this.auditTx(tx, platform, via, 'email_domain', 'delete', domain.id, { domain: domain.domain });
    });
    return { id: domain.id };
  }

  // -- Helpers --

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

  private domainConfig(d: { domain: string; mailFromDomain: string | null; dkimTokens: Prisma.JsonValue }) {
    const tokens = Array.isArray(d.dkimTokens) ? d.dkimTokens.filter((t): t is string => typeof t === 'string') : [];
    return { domain: d.domain, mailFromDomain: d.mailFromDomain, dkimTokens: tokens, sesRegion: this.config.get<string>('SES_REGION') ?? null };
  }

  private toDomainDto(
    d: {
      id: string;
      domain: string;
      purpose: string;
      mailFromDomain: string | null;
      dkimTokens: Prisma.JsonValue;
      spfStatus: string;
      dkimStatus: string;
      dmarcStatus: string;
      dmarcPolicy: string | null;
      lastCheckedAt: Date | null;
      lastError: string | null;
      dailyCap: number | null;
      createdAt: Date;
    },
    checked?: EmailSenderDomainDTO['expectedRecords'],
  ): EmailSenderDomainDTO {
    const spf = d.spfStatus as DnsRecordStatus;
    const dkim = d.dkimStatus as DnsRecordStatus;
    const dmarc = d.dmarcStatus as DnsRecordStatus;
    const records =
      checked ??
      expectedEmailDomainRecords(this.domainConfig(d)).map((r) => ({
        ...r,
        // Without a fresh lookup the stored aggregate status is the best we know.
        status: r.kind === 'SPF' ? spf : r.kind === 'DKIM' ? dkim : r.kind === 'DMARC' ? dmarc : r.status,
      }));
    return {
      id: d.id,
      domain: d.domain,
      purpose: d.purpose as EmailDomainPurpose,
      mailFromDomain: d.mailFromDomain,
      spfStatus: spf,
      dkimStatus: dkim,
      dmarcStatus: dmarc,
      dmarcPolicy: d.dmarcPolicy,
      verified: spf === 'VALID' && dkim === 'VALID' && dmarc === 'VALID',
      expectedRecords: records,
      lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
      lastError: d.lastError,
      dailyCap: d.dailyCap,
      createdAt: d.createdAt.toISOString(),
    };
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
