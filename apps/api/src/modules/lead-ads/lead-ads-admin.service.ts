import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@platform/database';
import { LeadAdFieldMappingSchema } from '@platform/shared';
import type {
  ConfigureLeadAdsInput,
  HubLeadAdFormMappingDTO,
  HubLeadAdsConnectionDTO,
  HubLeadAdsDTO,
  LeadAdEventDTO,
  LeadAdEventStatus,
  LeadAdsConnectionStatus,
  LeadgenVerifyTokenDTO,
  LeadgenVerifyTokenSetResultDTO,
  MetaCredentials,
  UpsertLeadAdFormMappingInput,
} from '@platform/shared';
import { LEAD_ADS_WEBHOOK_PATH } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCipher } from '../../common/crypto/credential-cipher';
import { META_GRAPH_CLIENT } from './meta-graph.client';
import type { MetaGraphClient } from './meta-graph.client';

const SETTINGS_ID = 'platform';
const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * The management side of Lead Ads for the integrations hub (M4c): the
 * connection's page and app secret, the per-form field mappings, the intake
 * log and the platform-wide webhook verify token. It never returns a
 * secret: the app secret is write-only and the verify token is stored as a
 * hash (its plaintext is shown once, when set). The hub service adds the
 * audit trail around each call.
 */
@Injectable()
export class LeadAdsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipher,
    private readonly config: ConfigService,
    @Inject(META_GRAPH_CLIENT) private readonly graph: MetaGraphClient,
  ) {}

  // -------------------------------------------------------------------------
  // Overview for the hub
  // -------------------------------------------------------------------------

  async overview(studioId: string, includeVerifyToken: boolean): Promise<HubLeadAdsDTO> {
    const [connections, forms, retryCount, failedCount, lastLead, verifyToken] = await Promise.all([
      this.prisma.adConnection.findMany({ where: { studioId, platform: 'META' }, orderBy: { createdAt: 'asc' } }),
      this.prisma.leadAdFormMapping.findMany({ where: { studioId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.leadAdEvent.count({ where: { studioId, status: { in: ['PENDING', 'RETRY'] } } }),
      this.prisma.leadAdEvent.count({ where: { studioId, status: 'FAILED' } }),
      this.prisma.leadAdEvent.findFirst({ where: { studioId, status: 'PROCESSED' }, orderBy: { processedAt: 'desc' }, select: { processedAt: true } }),
      includeVerifyToken ? this.verifyTokenState() : Promise.resolve(null),
    ]);
    const dtos: HubLeadAdsConnectionDTO[] = [];
    for (const c of connections) dtos.push(await this.connectionDto(studioId, c));
    return {
      connections: dtos,
      forms: forms.map(toFormDto),
      retryCount,
      failedCount,
      lastLeadAt: lastLead?.processedAt?.toISOString() ?? null,
      webhookPath: LEAD_ADS_WEBHOOK_PATH,
      verifyToken,
    };
  }

  private async connectionDto(studioId: string, c: { id: string; label: string; leadAdsPageId: string | null; leadAdsSubscribedAt: Date | null; encryptedCredentials: string }): Promise<HubLeadAdsConnectionDTO> {
    const [lastProcessed, latest, failedCount] = await Promise.all([
      this.prisma.leadAdEvent.findFirst({ where: { studioId, connectionId: c.id, status: 'PROCESSED' }, orderBy: { processedAt: 'desc' }, select: { processedAt: true } }),
      this.prisma.leadAdEvent.findFirst({ where: { studioId, connectionId: c.id }, orderBy: { receivedAt: 'desc' }, select: { status: true, lastError: true } }),
      this.prisma.leadAdEvent.count({ where: { studioId, connectionId: c.id, status: 'FAILED' } }),
    ]);
    const appSecretConfigured = Boolean(this.credentials(c.encryptedCredentials)?.appSecret);
    let status: LeadAdsConnectionStatus = 'NOT_CONFIGURED';
    if (c.leadAdsPageId && appSecretConfigured) status = 'CONFIGURED';
    if (status === 'CONFIGURED' && lastProcessed) status = 'RECEIVING';
    if (status !== 'NOT_CONFIGURED' && latest?.status === 'FAILED') status = 'ERROR';
    return {
      connectionId: c.id,
      label: c.label,
      pageId: c.leadAdsPageId,
      appSecretConfigured,
      status,
      subscribedAt: c.leadAdsSubscribedAt?.toISOString() ?? null,
      lastLeadAt: lastProcessed?.processedAt?.toISOString() ?? null,
      failedCount,
      lastError: latest?.status === 'FAILED' ? latest.lastError : null,
    };
  }

  // -------------------------------------------------------------------------
  // Connection: page id and app secret
  // -------------------------------------------------------------------------

  async configure(studioId: string, connectionId: string, input: ConfigureLeadAdsInput): Promise<HubLeadAdsConnectionDTO> {
    const connection = await this.prisma.adConnection.findFirst({ where: { id: connectionId, studioId, platform: 'META' } });
    if (!connection) throw new NotFoundException('Meta reklam bağlantısı bulunamadı');
    if (input.appSecret !== undefined && this.config.get<string>('NODE_ENV') === 'production' && !this.cipher.isConfigured) {
      throw new BadRequestException('INTEGRATION_ENCRYPTION_KEY yapılandırılmadan üretimde uygulama sırrı kaydedilemez');
    }
    const data: Prisma.AdConnectionUpdateInput = {};
    if (input.appSecret !== undefined) {
      const credentials = this.credentials(connection.encryptedCredentials);
      if (!credentials) throw new BadRequestException('Bağlantı kimlik bilgileri okunamadı; bağlantıyı yeniden kaydedin');
      data.encryptedCredentials = this.cipher.encrypt(JSON.stringify({ ...credentials, appSecret: input.appSecret }));
    }
    if (input.pageId !== undefined) {
      data.leadAdsPageId = input.pageId;
      // A new page starts unverified.
      data.leadAdsSubscribedAt = null;
    }
    try {
      const updated = await this.prisma.adConnection.update({ where: { id: connection.id }, data });
      return this.connectionDto(studioId, updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('Bu Facebook sayfası başka bir bağlantıya tanımlı');
      throw err;
    }
  }

  /** Asks Meta whether the app is subscribed to the page's leadgen field and remembers the answer. */
  async checkSubscription(studioId: string, connectionId: string): Promise<{ connection: HubLeadAdsConnectionDTO; subscribed: boolean }> {
    const connection = await this.prisma.adConnection.findFirst({ where: { id: connectionId, studioId, platform: 'META' } });
    if (!connection) throw new NotFoundException('Meta reklam bağlantısı bulunamadı');
    if (!connection.leadAdsPageId) throw new BadRequestException('Önce Facebook sayfa kimliği girilmeli');
    const credentials = this.credentials(connection.encryptedCredentials);
    if (!credentials) throw new BadRequestException('Bağlantı kimlik bilgileri okunamadı');
    const result = await this.graph.checkPageSubscription(credentials.accessToken, connection.leadAdsPageId);
    if (!result.ok) throw new BadRequestException('Meta abonelik durumunu vermedi');
    const updated = await this.prisma.adConnection.update({ where: { id: connection.id }, data: { leadAdsSubscribedAt: result.subscribed ? new Date() : null } });
    return { connection: await this.connectionDto(studioId, updated), subscribed: result.subscribed };
  }

  // -------------------------------------------------------------------------
  // Form mappings
  // -------------------------------------------------------------------------

  async upsertForm(studioId: string, userId: string, formId: string, input: UpsertLeadAdFormMappingInput): Promise<HubLeadAdFormMappingDTO> {
    const mapping = LeadAdFieldMappingSchema.parse(input.mapping);
    const row = await this.prisma.leadAdFormMapping.upsert({
      where: { studioId_formId: { studioId, formId } },
      create: { studioId, formId, formName: input.formName ?? null, mapping: mapping as Prisma.InputJsonValue, consentQuestionKey: input.consentQuestionKey, updatedByUserId: userId },
      update: { formName: input.formName ?? null, mapping: mapping as Prisma.InputJsonValue, consentQuestionKey: input.consentQuestionKey, updatedByUserId: userId },
    });
    return toFormDto(row);
  }

  async removeForm(studioId: string, formId: string): Promise<{ formId: string }> {
    const removed = await this.prisma.leadAdFormMapping.deleteMany({ where: { studioId, formId } });
    if (removed.count === 0) throw new NotFoundException('Form eşlemesi bulunamadı');
    return { formId };
  }

  // -------------------------------------------------------------------------
  // Intake log
  // -------------------------------------------------------------------------

  async events(studioId: string, limit = 50): Promise<LeadAdEventDTO[]> {
    const rows = await this.prisma.leadAdEvent.findMany({ where: { studioId }, orderBy: { receivedAt: 'desc' }, take: Math.min(Math.max(limit, 1), 200) });
    return rows.map((e) => ({
      id: e.id,
      leadgenId: e.leadgenId,
      formId: e.formId,
      pageId: e.pageId,
      status: e.status as LeadAdEventStatus,
      attempts: e.attempts,
      receivedAt: e.receivedAt.toISOString(),
      processedAt: e.processedAt?.toISOString() ?? null,
      contactId: e.contactId,
      lastError: e.lastError,
    }));
  }

  /** A failed event goes back to the queue with a fresh set of attempts (the heartbeat picks it up). */
  async retryEvent(studioId: string, id: string): Promise<{ id: string }> {
    const moved = await this.prisma.leadAdEvent.updateMany({
      where: { id, studioId, status: 'FAILED' },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: null, lastError: null },
    });
    if (moved.count === 0) throw new NotFoundException('Başarısız olay bulunamadı');
    return { id };
  }

  // -------------------------------------------------------------------------
  // Verify token (super admin)
  // -------------------------------------------------------------------------

  async verifyTokenState(): Promise<LeadgenVerifyTokenDTO> {
    const row = await this.prisma.platformIntegrationSettings.findUnique({ where: { id: SETTINGS_ID } });
    return { configured: Boolean(row?.leadgenVerifyTokenHash), last4: row?.leadgenVerifyTokenLast4 ?? null, setAt: row?.leadgenVerifyTokenSetAt?.toISOString() ?? null };
  }

  /** Stores the token's hash; a generated token is returned once. */
  async setVerifyToken(userId: string, chosen: string | undefined): Promise<LeadgenVerifyTokenSetResultDTO> {
    const token = chosen ?? randomBytes(24).toString('base64url');
    const now = new Date();
    const data = { leadgenVerifyTokenHash: hashToken(token), leadgenVerifyTokenLast4: token.slice(-4), leadgenVerifyTokenSetAt: now, updatedByUserId: userId };
    await this.prisma.platformIntegrationSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
    await this.prisma.auditLog.create({
      data: { studioId: null, userId, action: 'integration.lead_ads.verify_token_set', entityType: 'integration', entityId: SETTINGS_ID, metadata: { generated: chosen === undefined } },
    });
    return { configured: true, last4: token.slice(-4), setAt: now.toISOString(), token };
  }

  /** The handshake check: constant-time comparison of hashes; false while no token is set. */
  async isValidVerifyToken(candidate: string): Promise<boolean> {
    const row = await this.prisma.platformIntegrationSettings.findUnique({ where: { id: SETTINGS_ID }, select: { leadgenVerifyTokenHash: true } });
    if (!row?.leadgenVerifyTokenHash) return false;
    const expected = Buffer.from(row.leadgenVerifyTokenHash, 'hex');
    const given = Buffer.from(hashToken(candidate), 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private credentials(encrypted: string): MetaCredentials | null {
    try {
      return JSON.parse(this.cipher.decrypt(encrypted)) as MetaCredentials;
    } catch {
      return null;
    }
  }
}

function toFormDto(row: { id: string; formId: string; formName: string | null; mapping: Prisma.JsonValue; consentQuestionKey: string | null; updatedAt: Date }): HubLeadAdFormMappingDTO {
  const parsed = LeadAdFieldMappingSchema.safeParse(row.mapping);
  return { id: row.id, formId: row.formId, formName: row.formName, mapping: parsed.success ? parsed.data : {}, consentQuestionKey: row.consentQuestionKey, updatedAt: row.updatedAt.toISOString() };
}
