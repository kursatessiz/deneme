import { BadRequestException, HttpStatus, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, type ApprovalRequest, type SocialConnection, type SocialPost } from '@platform/database';
import {
  SOCIAL_NETWORK_LIMITS,
  approvalExpiresAt,
  decideSocialApproval,
  hasBlockingIssues,
  isGrantedApprovalStatus,
  isSocialPostEditable,
  parseSocialBrandCheck,
  runSocialPostChecks,
  socialTextLength,
  validateSocialPostShape,
  type ApprovalStatus,
  type ApprovalSummary,
  type CreateSocialPostInput,
  type SocialApprovalReason,
  type SocialBrandCheck,
  type SocialPostDTO,
  type SocialPostListDTO,
  type SocialPostsQuery,
  type SocialPostStatus,
  type UpdateSocialPostInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { PlatformContext } from '../../auth/tenant-context';
import { CampaignApprovalService } from '../../growth/campaigns/approval/campaign-approval.service';
import type { ApprovalTargetHandler } from '../../growth/campaigns/approval/approval-target-handler';
import { MarketingSettingsService } from '../../growth/campaigns/approval/marketing-settings.service';
import { mediaUrlsOf, socialPostContentHash } from '../../social/social-content-hash';
import { socialError } from '../../social/social-connections.service';
import { SocialPublishingService } from '../../social/social-publishing.service';
import { BrandKitService } from '../studio/brand-kit.service';

type Tx = Prisma.TransactionClient;
type PostWithConnection = SocialPost & { connection: SocialConnection };

const PREVIEW_LENGTH = 80;
/** A publish time this far in the past still counts as "now" (clock skew, a form left open). */
const PAST_GRACE_MS = 60_000;

function preview(text: string): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length > PREVIEW_LENGTH ? `${chars.slice(0, PREVIEW_LENGTH).join('')}...` : chars.join('');
}

/**
 * Organic social posts of the platform tenant (M4b, docs/PAZARLAMA_MODULU.md
 * 3.4, 4.3 and 6.1). A post is created from scratch, from an AI studio draft
 * or a calendar item, checked deterministically against the brand kit, and
 * scheduled: without a blocking brand issue (and unless the tenant sends
 * every social post to approval) the schedule is self-approved by a holder
 * of platform.marketing.send, otherwise a super admin must approve it in the
 * approval queue. The approval is bound to the content hash (account, text,
 * media, link, time); an edit after the decision drops it. Publishing itself
 * is SocialPublishingService, driven by the scheduler heartbeat.
 */
@Injectable()
export class SocialPostsService implements OnModuleInit, ApprovalTargetHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandKit: BrandKitService,
    private readonly publishing: SocialPublishingService,
    private readonly approvals: CampaignApprovalService,
    private readonly settings: MarketingSettingsService,
  ) {}

  onModuleInit(): void {
    this.approvals.registerTargetHandler('SOCIAL_POST', this);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(platform: PlatformContext, query: SocialPostsQuery): Promise<SocialPostListDTO> {
    const rows = await this.prisma.socialPost.findMany({
      where: {
        studioId: platform.platformStudioId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.connectionId ? { connectionId: query.connectionId } : {}),
        ...(query.calendarItemId ? { calendarItemId: query.calendarItemId } : {}),
      },
      include: { connection: true },
      orderBy: [{ createdAt: 'desc' }],
      take: query.limit,
    });
    return { items: await this.toDtos(rows) };
  }

  async get(platform: PlatformContext, id: string): Promise<SocialPostDTO> {
    return (await this.toDtos([await this.find(platform.platformStudioId, id)]))[0];
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  async create(platform: PlatformContext, input: CreateSocialPostInput): Promise<SocialPostDTO> {
    const studioId = platform.platformStudioId;
    const connection = await this.connection(studioId, input.connectionId);
    await this.assertLinks(studioId, input);
    const mediaUrls = input.mediaUrls;
    const brandCheck = await this.brandCheck(studioId, connection, input.locale, input.text, input.link ?? null);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.socialPost.create({
        data: {
          studioId,
          connectionId: connection.id,
          locale: input.locale,
          text: input.text,
          mediaUrls: mediaUrls as Prisma.InputJsonValue,
          link: input.link ?? null,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          aiDraftId: input.aiDraftId ?? null,
          calendarItemId: input.calendarItemId ?? null,
          createdByUserId: platform.userId,
          brandCheck: brandCheck as unknown as Prisma.InputJsonValue,
        },
        include: { connection: true },
      });
      await this.audit(tx, platform.platformStudioId, platform.userId, 'social.post.create', created.id, {
        provider: connection.provider,
        fromDraft: Boolean(input.aiDraftId),
        fromCalendarItem: Boolean(input.calendarItemId),
        blocking: hasBlockingIssues(brandCheck.issues),
      });
      return created;
    });
    return (await this.toDtos([row]))[0];
  }

  async update(platform: PlatformContext, id: string, input: UpdateSocialPostInput): Promise<SocialPostDTO> {
    const studioId = platform.platformStudioId;
    const existing = await this.find(studioId, id);
    if (!isSocialPostEditable(existing.status)) throw socialError('SOCIAL_POST_NOT_EDITABLE', 'Bu durumdaki gönderi değiştirilemez');
    const connection = input.connectionId ? await this.connection(studioId, input.connectionId) : existing.connection;
    await this.assertLinks(studioId, input);

    const next = {
      connectionId: connection.id,
      locale: input.locale ?? existing.locale,
      text: input.text ?? existing.text,
      mediaUrls: input.mediaUrls ?? mediaUrlsOf(existing.mediaUrls),
      link: input.link !== undefined ? input.link : existing.link,
      scheduledAt: input.scheduledAt !== undefined ? (input.scheduledAt ? new Date(input.scheduledAt) : null) : existing.scheduledAt,
    };
    const brandCheck = await this.brandCheck(studioId, connection, next.locale, next.text, next.link);
    const hashBefore = this.hashOf(existing);
    const hashAfter = socialPostContentHash({ ...next, scheduledAt: next.scheduledAt?.toISOString() ?? null });
    const contentChanged = hashBefore !== hashAfter;
    // Any change of what an approval is bound to sends the post back to a draft; a failed post is edited back to a draft too.
    const dropsApproval = existing.status === 'FAILED' || (contentChanged && (existing.status === 'PENDING_APPROVAL' || existing.status === 'SCHEDULED'));

    const row = await this.prisma.$transaction(async (tx) => {
      if (dropsApproval && existing.approvalRequestId) await this.cancelRequest(tx, existing, 'CONTENT_CHANGED');
      const updated = await tx.socialPost.update({
        where: { id },
        data: {
          connectionId: next.connectionId,
          locale: next.locale,
          text: next.text,
          mediaUrls: next.mediaUrls as Prisma.InputJsonValue,
          link: next.link,
          scheduledAt: next.scheduledAt,
          ...(input.aiDraftId !== undefined ? { aiDraftId: input.aiDraftId } : {}),
          ...(input.calendarItemId !== undefined ? { calendarItemId: input.calendarItemId } : {}),
          brandCheck: brandCheck as unknown as Prisma.InputJsonValue,
          ...(dropsApproval ? { status: 'DRAFT' as const, lastError: null, attemptCount: 0, nextAttemptAt: null } : {}),
        },
        include: { connection: true },
      });
      await this.audit(tx, studioId, platform.userId, 'social.post.update', id, { contentChanged, approvalDropped: dropsApproval && Boolean(existing.approvalRequestId) });
      return updated;
    });
    return (await this.toDtos([row]))[0];
  }

  async remove(platform: PlatformContext, id: string): Promise<{ deleted: true }> {
    const studioId = platform.platformStudioId;
    const existing = await this.find(studioId, id);
    if (!['DRAFT', 'CANCELLED', 'FAILED'].includes(existing.status)) throw socialError('SOCIAL_POST_NOT_EDITABLE', 'Bu durumdaki gönderi silinemez');
    await this.prisma.$transaction(async (tx) => {
      await tx.socialPost.delete({ where: { id } });
      await this.audit(tx, studioId, platform.userId, 'social.post.delete', id, { status: existing.status });
    });
    return { deleted: true };
  }

  async cancel(platform: PlatformContext, id: string): Promise<SocialPostDTO> {
    const studioId = platform.platformStudioId;
    const existing = await this.find(studioId, id);
    if (!isSocialPostEditable(existing.status)) throw socialError('SOCIAL_POST_NOT_EDITABLE', 'Bu durumdaki gönderi iptal edilemez');
    const row = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.socialPost.updateMany({ where: { id, studioId, status: existing.status }, data: { status: 'CANCELLED', nextAttemptAt: null } });
      if (moved.count === 0) throw socialError('SOCIAL_POST_NOT_EDITABLE', 'Gönderinin durumu değişti');
      if (existing.approvalRequestId) await this.cancelRequest(tx, existing, 'CANCELLED');
      await this.audit(tx, studioId, platform.userId, 'social.post.cancel', id, { from: existing.status });
      return tx.socialPost.findUniqueOrThrow({ where: { id }, include: { connection: true } });
    });
    return (await this.toDtos([row]))[0];
  }

  /** POST schedule: self-approved or waiting for a super admin (section 6.1). */
  async schedule(platform: PlatformContext, id: string, scheduledAtInput: string, now = new Date()): Promise<SocialPostDTO> {
    const scheduledAt = new Date(scheduledAtInput);
    if (scheduledAt.getTime() < now.getTime() - PAST_GRACE_MS) {
      throw new BadRequestException({ statusCode: 400, code: 'SOCIAL_SCHEDULE_IN_PAST', message: 'Yayın zamanı geçmişte olamaz' });
    }
    const row = await this.submit(platform, id, scheduledAt, now, 'SCHEDULE');
    return (await this.toDtos([row]))[0];
  }

  /**
   * POST publish-now: the same approval rules as a schedule at the current
   * time; when no approval is needed the post is sent right away. A used-up
   * Instagram quota answers 409 SOCIAL_QUOTA_EXHAUSTED and leaves the post SCHEDULED.
   */
  async publishNow(platform: PlatformContext, id: string, now = new Date()): Promise<SocialPostDTO> {
    const existing = await this.find(platform.platformStudioId, id);
    if (existing.status === 'PENDING_APPROVAL') throw socialError('SOCIAL_APPROVAL_REQUIRED', 'Bu gönderi için süper admin onayı bekleniyor');
    const row = await this.submit(platform, id, now, now, 'NOW');
    if (row.status === 'SCHEDULED') {
      const outcome = await this.publishing.publish(row.id, now);
      if (outcome.kind === 'QUOTA_EXHAUSTED') throw socialError('SOCIAL_QUOTA_EXHAUSTED', 'Instagram 24 saatlik yayın sınırı doldu; gönderi planlı kalır');
    }
    return this.get(platform, id);
  }

  // ---------------------------------------------------------------------------
  // Approval target handler (called by the approval queue)
  // ---------------------------------------------------------------------------

  async currentHash(request: ApprovalRequest): Promise<string | null> {
    const post = await this.prisma.socialPost.findFirst({ where: { id: request.targetId, studioId: request.studioId, approvalRequestId: request.id, status: 'PENDING_APPROVAL' } });
    return post ? this.hashOf(post) : null;
  }

  async onApproved(tx: Tx, request: ApprovalRequest): Promise<void> {
    await tx.socialPost.updateMany({
      where: { id: request.targetId, studioId: request.studioId, approvalRequestId: request.id, status: 'PENDING_APPROVAL' },
      data: { status: 'SCHEDULED', lastError: null, attemptCount: 0, nextAttemptAt: null },
    });
    await this.audit(tx, request.studioId, request.decidedByUserId, 'social.post.approved', request.targetId, { requestId: request.id });
  }

  async onClosed(tx: Tx, request: ApprovalRequest, reason: 'REJECTED' | 'CANCELLED' | 'EXPIRED' | 'CONTENT_CHANGED'): Promise<void> {
    const moved = await tx.socialPost.updateMany({
      where: { id: request.targetId, studioId: request.studioId, approvalRequestId: request.id, status: 'PENDING_APPROVAL' },
      data: { status: 'DRAFT', lastError: null },
    });
    if (moved.count > 0) await this.audit(tx, request.studioId, request.decidedByUserId, 'social.post.approval_closed', request.targetId, { requestId: request.id, reason });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async submit(platform: PlatformContext, id: string, scheduledAt: Date, now: Date, mode: 'SCHEDULE' | 'NOW'): Promise<PostWithConnection> {
    const studioId = platform.platformStudioId;
    const post = await this.find(studioId, id);
    if (!['DRAFT', 'FAILED', 'PENDING_APPROVAL', 'SCHEDULED'].includes(post.status)) {
      throw socialError('SOCIAL_POST_NOT_SCHEDULABLE', 'Bu durumdaki gönderi planlanamaz');
    }
    const mediaUrls = mediaUrlsOf(post.mediaUrls);
    const shape = validateSocialPostShape(post.connection.provider, { mediaUrls });
    if (shape.length > 0) {
      throw new BadRequestException({ statusCode: 400, code: 'SOCIAL_POST_INVALID', message: 'Gönderi seçilen ağın kurallarına uymuyor', issues: shape });
    }
    // The brand kit may have changed since the post was saved: check again on every submission.
    const brandCheck = await this.brandCheck(studioId, post.connection, post.locale, post.text, post.link);
    const settings = await this.settings.get(studioId);
    const decision = decideSocialApproval({ requireApprovalForSocial: settings.requireApprovalForSocial, issues: brandCheck.issues });
    const contentHash = socialPostContentHash({
      connectionId: post.connectionId,
      text: post.text,
      mediaUrls,
      link: post.link,
      scheduledAt: scheduledAt.toISOString(),
    });
    const status: ApprovalStatus = decision.required ? 'PENDING' : 'SELF_APPROVED';

    const { row, request } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.approvalRequest.create({
        data: {
          studioId,
          targetType: 'SOCIAL_POST',
          targetId: post.id,
          contentHash,
          summary: this.summaryFor(post, mediaUrls, scheduledAt, decision.reasons, decision.required, settings, now) as unknown as Prisma.InputJsonValue,
          status,
          requestedByUserId: platform.userId,
          decidedByUserId: decision.required ? null : platform.userId,
          decidedAt: decision.required ? null : now,
          expiresAt: approvalExpiresAt(now, settings.approvalTtlHours),
          createdAt: now,
        },
      });
      if (post.approvalRequestId && post.approvalRequestId !== created.id) await this.cancelRequest(tx, post, 'RESUBMITTED', created.id);
      const updated = await tx.socialPost.update({
        where: { id: post.id },
        data: {
          status: decision.required ? 'PENDING_APPROVAL' : 'SCHEDULED',
          scheduledAt,
          approvalRequestId: created.id,
          brandCheck: brandCheck as unknown as Prisma.InputJsonValue,
          lastError: null,
          attemptCount: 0,
          nextAttemptAt: null,
        },
        include: { connection: true },
      });
      await this.audit(tx, studioId, platform.userId, decision.required ? 'social.post.approval_requested' : 'social.post.scheduled', post.id, {
        mode,
        scheduledAt: scheduledAt.toISOString(),
        reasons: decision.reasons,
        requestId: created.id,
      });
      await tx.auditLog.create({
        data: {
          studioId,
          userId: platform.userId,
          action: decision.required ? 'marketing.approval.requested' : 'marketing.approval.self_approved',
          entityType: 'ApprovalRequest',
          entityId: created.id,
          metadata: { targetType: 'SOCIAL_POST', targetId: post.id, reasons: decision.reasons, status } as Prisma.InputJsonValue,
        },
      });
      return { row: updated, request: created };
    });
    if (decision.required) await this.approvals.notifyPending(request);
    return row;
  }

  private summaryFor(
    post: PostWithConnection,
    mediaUrls: readonly string[],
    scheduledAt: Date,
    reasons: SocialApprovalReason[],
    approvalRequired: boolean,
    settings: { selfApproveEmailMax: number; selfApproveSmsMax: number; selfApproveSmsCredits: number },
    now: Date,
  ): ApprovalSummary {
    return {
      version: 1,
      target: { name: preview(post.text), channel: post.connection.provider, templateKey: null, segmentId: null, segmentName: null },
      requestedSchedule: scheduledAt.toISOString(),
      channels: [],
      audience: { total: 0, reachable: {} },
      countries: {},
      regions: {},
      newCountries: [],
      cost: { smsCredits: 0, messages: {}, byCurrency: {} },
      findings: [],
      reasons,
      selfApprovable: !approvalRequired,
      segmentApprovedBefore: true,
      emailDomainVerified: false,
      thresholds: { selfApproveEmailMax: settings.selfApproveEmailMax, selfApproveSmsMax: settings.selfApproveSmsMax, selfApproveSmsCredits: settings.selfApproveSmsCredits },
      evaluatedAt: now.toISOString(),
      social: { provider: post.connection.provider, connectionName: post.connection.displayName, textPreview: preview(post.text), mediaCount: mediaUrls.length, link: post.link },
    };
  }

  /** The post's open or granted request no longer applies: CANCELLED and marked as invalidated. */
  private async cancelRequest(tx: Tx, post: SocialPost, reason: 'CONTENT_CHANGED' | 'CANCELLED' | 'RESUBMITTED', replacedBy: string | null = null): Promise<void> {
    if (!post.approvalRequestId) return;
    const previous = await tx.approvalRequest.findFirst({ where: { id: post.approvalRequestId, studioId: post.studioId } });
    if (!previous || (previous.status !== 'PENDING' && !isGrantedApprovalStatus(previous.status))) return;
    const summary = previous.summary as unknown as ApprovalSummary;
    await tx.approvalRequest.update({
      where: { id: previous.id },
      data: {
        status: 'CANCELLED',
        decidedAt: previous.decidedAt ?? new Date(),
        summary: { ...summary, invalidated: { at: new Date().toISOString(), reason: reason === 'CANCELLED' ? 'CONTENT_CHANGED' : reason, replacedByRequestId: replacedBy } } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private hashOf(post: SocialPost): string {
    return socialPostContentHash({
      connectionId: post.connectionId,
      text: post.text,
      mediaUrls: mediaUrlsOf(post.mediaUrls),
      link: post.link,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
    });
  }

  private async brandCheck(studioId: string, connection: SocialConnection, locale: string, text: string, link: string | null): Promise<SocialBrandCheck> {
    const ctx = await this.brandKit.loadCheckContext(studioId, locale, 'SOCIAL_POST');
    return { checkedAt: new Date().toISOString(), issues: runSocialPostChecks(connection.provider, { text, link }, ctx) };
  }

  private async find(studioId: string, id: string): Promise<PostWithConnection> {
    const post = await this.prisma.socialPost.findFirst({ where: { id, studioId }, include: { connection: true } });
    if (!post) throw new NotFoundException('Gönderi bulunamadı');
    return post;
  }

  private async connection(studioId: string, id: string): Promise<SocialConnection> {
    const connection = await this.prisma.socialConnection.findFirst({ where: { id, studioId } });
    if (!connection) throw new BadRequestException({ statusCode: HttpStatus.BAD_REQUEST, code: 'SOCIAL_POST_INVALID', message: 'Sosyal hesap bulunamadı' });
    return connection;
  }

  /** The AI draft and the calendar item must belong to the platform tenant; a calendar item must be a social one. */
  private async assertLinks(studioId: string, input: { aiDraftId?: string | null; calendarItemId?: string | null }): Promise<void> {
    if (input.aiDraftId) {
      const draft = await this.prisma.marketingDraft.findFirst({ where: { id: input.aiDraftId, studioId }, select: { id: true } });
      if (!draft) throw new BadRequestException({ statusCode: 400, code: 'SOCIAL_POST_INVALID', message: 'Taslak bulunamadı' });
    }
    if (input.calendarItemId) {
      const item = await this.prisma.contentCalendarItem.findFirst({ where: { id: input.calendarItemId, studioId }, select: { channel: true } });
      if (!item || item.channel !== 'SOCIAL') throw new BadRequestException({ statusCode: 400, code: 'SOCIAL_POST_INVALID', message: 'Sosyal takvim öğesi bulunamadı' });
    }
  }

  private async toDtos(rows: PostWithConnection[]): Promise<SocialPostDTO[]> {
    const requestIds = [...new Set(rows.map((r) => r.approvalRequestId).filter((v): v is string => Boolean(v)))];
    const requests = requestIds.length ? await this.prisma.approvalRequest.findMany({ where: { id: { in: requestIds } } }) : [];
    return rows.map((r) => {
      const request = requests.find((q) => q.id === r.approvalRequestId && q.studioId === r.studioId);
      const summary = request ? (request.summary as unknown as ApprovalSummary) : null;
      const mediaUrls = mediaUrlsOf(r.mediaUrls);
      return {
        id: r.id,
        connectionId: r.connectionId,
        provider: r.connection.provider,
        connectionName: r.connection.displayName,
        status: r.status as SocialPostStatus,
        locale: r.locale,
        text: r.text,
        mediaUrls,
        link: r.link,
        scheduledAt: r.scheduledAt?.toISOString() ?? null,
        publishedAt: r.publishedAt?.toISOString() ?? null,
        externalPostId: r.externalPostId,
        lastError: r.lastError,
        aiDraftId: r.aiDraftId,
        calendarItemId: r.calendarItemId,
        approval: request
          ? {
              id: request.id,
              status: request.status,
              reasons: (summary?.reasons ?? []).filter((x): x is SocialApprovalReason => x === 'SOCIAL_APPROVAL_REQUIRED_SETTING' || x === 'SOCIAL_BRAND_CHECK_BLOCKING'),
              expiresAt: request.expiresAt.toISOString(),
            }
          : null,
        brandCheck: parseSocialBrandCheck(r.brandCheck),
        textLength: socialTextLength(r.connection.provider, r.text, r.link),
        textLimit: SOCIAL_NETWORK_LIMITS[r.connection.provider].maxTextLength,
        createdByUserId: r.createdByUserId,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  private async audit(tx: Tx, studioId: string, userId: string | null, action: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
    await tx.auditLog.create({ data: { studioId, userId, action, entityType: 'SocialPost', entityId, metadata: metadata as Prisma.InputJsonValue } });
  }
}
