import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@platform/database';
import type { ApprovalRequest, Campaign } from '@platform/database';
import {
  BASE_MESSAGES,
  BUNDLED_MESSAGES,
  MARKETING_APPROVAL_TEMPLATE_KEYS,
  approvalExpiresAt,
  approvalOutcomeFor,
  canRequestCampaignApproval,
  contactDisplayName,
  createTranslator,
  isApprovalExpired,
  isGrantedApprovalStatus,
} from '@platform/shared';
import type {
  ApprovalListDTO,
  ApprovalListQuery,
  ApprovalRequestDTO,
  ApprovalStatus,
  ApprovalSummary,
  ApprovalTargetType,
  MarketingApprovalErrorCode,
  RequestApprovalResultDTO,
} from '@platform/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { MessagingService } from '../../../messaging/engine/messaging.service';
import { GrowthQueueService } from '../../growth-queue.service';
import type { ApprovalTargetHandler } from './approval-target-handler';
import { CampaignPrecheckService } from './campaign-precheck.service';
import { MarketingSettingsService } from './marketing-settings.service';

/** Who acts on a request: resolved from the platform guard (or the tenant guard's user for campaign edits). */
export interface ApprovalActor {
  userId: string;
  isSuperAdmin: boolean;
}

export function approvalError(status: HttpStatus, code: MarketingApprovalErrorCode, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

function asSummary(raw: Prisma.JsonValue): ApprovalSummary {
  return raw as unknown as ApprovalSummary;
}

type Tx = Prisma.TransactionClient;

/**
 * Approval flow for campaigns of the platform tenant (docs/PAZARLAMA_MODULU.md
 * 6.1). A campaign of the platform tenant goes out only while it points to
 * an APPROVED or SELF_APPROVED request whose content hash still matches the
 * campaign: the send path calls verifyForSend() before taking the audience
 * snapshot, edits call onCampaignChanged(), and a mismatch replaces the
 * request with a new PENDING one. Other tenants never reach this service
 * (isPlatformStudio() is false for them), so their campaigns behave as
 * before. Every decision writes AuditLog on the platform tenant.
 */
@Injectable()
export class CampaignApprovalService {
  private readonly logger = new Logger(CampaignApprovalService.name);
  /** Targets other than campaigns (M4b: SOCIAL_POST) decide through their own handler. */
  private readonly targetHandlers = new Map<string, ApprovalTargetHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly precheck: CampaignPrecheckService,
    private readonly settings: MarketingSettingsService,
    private readonly messaging: MessagingService,
    private readonly queue: GrowthQueueService,
  ) {}

  registerTargetHandler(targetType: ApprovalTargetType, handler: ApprovalTargetHandler): void {
    this.targetHandlers.set(targetType, handler);
  }

  async isPlatformStudio(studioId: string): Promise<boolean> {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { isPlatform: true } });
    return Boolean(studio?.isPlatform);
  }

  // ---------------------------------------------------------------------------
  // Requests
  // ---------------------------------------------------------------------------

  /** POST /platform/marketing/campaigns/:id/request-approval */
  async requestForCampaign(studioId: string, actor: ApprovalActor, campaignId: string, scheduledAt: string | undefined, now = new Date()): Promise<RequestApprovalResultDTO> {
    const campaign = await this.campaign(studioId, campaignId);
    if (!canRequestCampaignApproval(campaign.status) || campaign.startedAt) {
      throw approvalError(HttpStatus.CONFLICT, 'CAMPAIGN_NOT_REQUESTABLE', 'Bu durumdaki kampanya için onay istenemez');
    }
    if (scheduledAt && new Date(scheduledAt).getTime() < now.getTime() - 60_000) throw new BadRequestException('Geçmiş bir zamana planlanamaz');
    const schedule = scheduledAt ? new Date(scheduledAt).toISOString() : null;
    const settings = await this.settings.get(studioId);
    const check = await this.precheck.run(campaign, schedule, settings, now);
    const selfApproved = check.summary.selfApprovable;
    const status: ApprovalStatus = selfApproved ? 'SELF_APPROVED' : 'PENDING';

    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.approvalRequest.create({
        data: {
          studioId,
          targetType: 'CAMPAIGN',
          targetId: campaign.id,
          contentHash: check.contentHash,
          summary: check.summary as unknown as Prisma.InputJsonValue,
          status,
          requestedByUserId: actor.userId,
          decidedByUserId: selfApproved ? actor.userId : null,
          decidedAt: selfApproved ? now : null,
          expiresAt: approvalExpiresAt(now, settings.approvalTtlHours),
          createdAt: now,
        },
      });
      await this.supersede(tx, campaign, created.id, 'RESUBMITTED', now);
      if (selfApproved) {
        await tx.campaign.update({ where: { id: campaign.id }, data: { status: 'SCHEDULED', scheduledAt: this.sendTime(schedule, now), approvalRequestId: created.id } });
      } else {
        await tx.campaign.update({ where: { id: campaign.id }, data: { status: 'PENDING_APPROVAL', scheduledAt: schedule ? new Date(schedule) : null, approvalRequestId: created.id } });
      }
      await this.audit(tx, studioId, actor.userId, selfApproved ? 'marketing.approval.self_approved' : 'marketing.approval.requested', created, {
        campaignId: campaign.id,
        audience: check.summary.audience.total,
        reasons: check.summary.reasons,
      });
      return created;
    });

    if (selfApproved) await this.queue.scheduleCampaign(campaign.id, this.sendTime(schedule, now));
    else await this.notifySuperAdmins(request, actor.userId);
    return { request: await this.toDto(request, actor), campaignStatus: selfApproved ? 'SCHEDULED' : 'PENDING_APPROVAL' };
  }

  async approve(studioId: string, actor: ApprovalActor, id: string, note: string | undefined, now = new Date()): Promise<ApprovalRequestDTO> {
    const request = await this.pending(studioId, id, now);
    const outcome = approvalOutcomeFor({ requestedByUserId: request.requestedByUserId, approverUserId: actor.userId, approverIsSuperAdmin: actor.isSuperAdmin });
    if (outcome === 'FOUR_EYES_VIOLATION') throw approvalError(HttpStatus.FORBIDDEN, 'APPROVAL_FOUR_EYES', 'Kendi talebinizi onaylayamazsınız');
    if (request.targetType !== 'CAMPAIGN') return this.approveOther(studioId, actor, request, outcome, note, now);
    const campaign = await this.targetCampaign(request);

    // The content must still be what the requester submitted.
    const summary = asSummary(request.summary);
    const print = await this.precheck.fingerprint(campaign, summary.requestedSchedule, now);
    if (print.contentHash !== request.contentHash) {
      await this.invalidate(campaign, request, request.requestedByUserId, now);
      throw approvalError(HttpStatus.CONFLICT, 'APPROVAL_CONTENT_CHANGED', 'Kampanya talepten sonra değişti; yeni bir onay talebi oluşturuldu');
    }

    const sendAt = this.sendTime(summary.requestedSchedule, now);
    const decided = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.approvalRequest.update({
        where: { id: request.id },
        data: {
          status: outcome,
          decidedByUserId: actor.userId,
          decidedAt: now,
          decisionNote: note?.trim() || null,
          ...(outcome === 'SELF_APPROVED' ? { summary: { ...summary, selfApprovedBySuperAdmin: true } as unknown as Prisma.InputJsonValue } : {}),
        },
      });
      await tx.campaign.update({ where: { id: campaign.id }, data: { status: campaign.startedAt ? 'SENDING' : 'SCHEDULED', scheduledAt: campaign.startedAt ? campaign.scheduledAt : sendAt } });
      await this.audit(tx, studioId, actor.userId, outcome === 'SELF_APPROVED' ? 'marketing.approval.self_approved_by_super_admin' : 'marketing.approval.approved', updated, {
        campaignId: campaign.id,
        note: note?.trim() || null,
      });
      return updated;
    });
    await this.queue.scheduleCampaign(campaign.id, campaign.startedAt ? now : sendAt);
    if (request.requestedByUserId !== actor.userId) await this.notifyRequester(decided, 'approved');
    return this.toDto(decided, actor);
  }

  /** Approval of a non-campaign target (M4b: social posts): the content must still be what the requester submitted. */
  private async approveOther(
    studioId: string,
    actor: ApprovalActor,
    request: ApprovalRequest,
    outcome: 'APPROVED' | 'SELF_APPROVED',
    note: string | undefined,
    now: Date,
  ): Promise<ApprovalRequestDTO> {
    const handler = this.targetHandlers.get(request.targetType);
    const hash = handler ? await handler.currentHash(request) : null;
    if (!handler || hash === null) throw approvalError(HttpStatus.CONFLICT, 'APPROVAL_NOT_PENDING', 'Talep artık geçerli değil');
    if (hash !== request.contentHash) {
      await this.prisma.$transaction(async (tx) => {
        await tx.approvalRequest.updateMany({
          where: { id: request.id, status: 'PENDING' },
          data: {
            status: 'CANCELLED',
            decidedAt: now,
            summary: { ...asSummary(request.summary), invalidated: { at: now.toISOString(), reason: 'CONTENT_CHANGED', replacedByRequestId: null } } as unknown as Prisma.InputJsonValue,
          },
        });
        await handler.onClosed(tx, request, 'CONTENT_CHANGED');
        await this.audit(tx, studioId, actor.userId, 'marketing.approval.invalidated', request, { targetId: request.targetId });
      });
      throw approvalError(HttpStatus.CONFLICT, 'APPROVAL_CONTENT_CHANGED', 'İçerik talepten sonra değişti; yeniden onay istenmeli');
    }
    const summary = asSummary(request.summary);
    const decided = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.approvalRequest.updateMany({
        where: { id: request.id, status: 'PENDING' },
        data: {
          status: outcome,
          decidedByUserId: actor.userId,
          decidedAt: now,
          decisionNote: note?.trim() || null,
          ...(outcome === 'SELF_APPROVED' ? { summary: { ...summary, selfApprovedBySuperAdmin: true } as unknown as Prisma.InputJsonValue } : {}),
        },
      });
      if (moved.count === 0) throw approvalError(HttpStatus.CONFLICT, 'APPROVAL_NOT_PENDING', 'Talep bekleyen durumda değil');
      const updated = await tx.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
      await handler.onApproved(tx, updated);
      await this.audit(tx, studioId, actor.userId, outcome === 'SELF_APPROVED' ? 'marketing.approval.self_approved_by_super_admin' : 'marketing.approval.approved', updated, {
        targetId: request.targetId,
        note: note?.trim() || null,
      });
      return updated;
    });
    if (request.requestedByUserId !== actor.userId) await this.notifyRequester(decided, 'approved');
    return this.toDto(decided, actor);
  }

  /** Tells the super admins a non-campaign request is waiting (campaign requests notify from requestForCampaign). */
  async notifyPending(request: ApprovalRequest): Promise<void> {
    await this.notifySuperAdmins(request, request.requestedByUserId);
  }

  async reject(studioId: string, actor: ApprovalActor, id: string, note: string, now = new Date()): Promise<ApprovalRequestDTO> {
    const request = await this.pending(studioId, id, now);
    const decided = await this.close(request, actor, 'REJECTED', note, 'marketing.approval.rejected', now);
    if (request.requestedByUserId !== actor.userId) await this.notifyRequester(decided, 'rejected');
    return this.toDto(decided, actor);
  }

  async cancel(studioId: string, actor: ApprovalActor, id: string, note: string | undefined, now = new Date()): Promise<ApprovalRequestDTO> {
    const request = await this.pending(studioId, id, now);
    if (!actor.isSuperAdmin && request.requestedByUserId !== actor.userId) {
      throw approvalError(HttpStatus.FORBIDDEN, 'APPROVAL_CANCEL_FORBIDDEN', 'Yalnızca talep eden veya süper admin iptal edebilir');
    }
    const decided = await this.close(request, actor, 'CANCELLED', note, 'marketing.approval.cancelled', now);
    return this.toDto(decided, actor);
  }

  async list(studioId: string, actor: ApprovalActor, query: ApprovalListQuery): Promise<ApprovalListDTO> {
    const [rows, pendingCount] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where: { studioId, ...(query.status ? { status: query.status } : {}), ...(query.targetId ? { targetId: query.targetId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
      this.prisma.approvalRequest.count({ where: { studioId, status: 'PENDING' } }),
    ]);
    return { items: await this.toDtos(rows, actor), pendingCount };
  }

  async detail(studioId: string, actor: ApprovalActor, id: string): Promise<ApprovalRequestDTO> {
    const row = await this.prisma.approvalRequest.findFirst({ where: { id, studioId } });
    if (!row) throw new NotFoundException('Onay talebi bulunamadı');
    return this.toDto(row, actor);
  }

  // ---------------------------------------------------------------------------
  // Send path and edits (called by CampaignsService for the platform tenant)
  // ---------------------------------------------------------------------------

  /**
   * Called before a due SCHEDULED campaign takes its audience snapshot. Returns
   * the audience when the campaign may go out; otherwise moves it out of
   * SCHEDULED (no request: back to DRAFT; content changed: PENDING_APPROVAL
   * with a new request) and returns null.
   */
  async verifyForSend(campaign: Campaign, now: Date): Promise<string[] | null> {
    const request = campaign.approvalRequestId
      ? await this.prisma.approvalRequest.findFirst({ where: { id: campaign.approvalRequestId, studioId: campaign.studioId } })
      : null;
    if (!request || !isGrantedApprovalStatus(request.status)) {
      // Scheduled without a granted request (e.g. before M3b): it has to be requested again.
      await this.prisma.$transaction(async (tx) => {
        const moved = await tx.campaign.updateMany({ where: { id: campaign.id, status: 'SCHEDULED' }, data: { status: 'DRAFT' } });
        if (moved.count === 1) {
          await tx.auditLog.create({
            data: { studioId: campaign.studioId, userId: null, action: 'marketing.approval.missing', entityType: 'Campaign', entityId: campaign.id, metadata: { requestId: request?.id ?? null } },
          });
        }
      });
      return null;
    }
    const summary = asSummary(request.summary);
    const print = await this.precheck.fingerprint(campaign, summary.requestedSchedule, now);
    if (print.contentHash === request.contentHash) return print.contactIds;
    await this.invalidate(campaign, request, request.requestedByUserId, now);
    return null;
  }

  /**
   * After an edit of a campaign that has an open or granted request: when the
   * approved content changed, the approval no longer counts.
   */
  async onCampaignChanged(campaignId: string, actorUserId: string | null, now = new Date()): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign?.approvalRequestId || !['SCHEDULED', 'PENDING_APPROVAL', 'PAUSED'].includes(campaign.status)) return;
    const request = await this.prisma.approvalRequest.findFirst({ where: { id: campaign.approvalRequestId, studioId: campaign.studioId } });
    if (!request || (request.status !== 'PENDING' && !isGrantedApprovalStatus(request.status))) return;
    const print = await this.precheck.fingerprint(campaign, asSummary(request.summary).requestedSchedule, now);
    if (print.contentHash === request.contentHash) return;
    await this.invalidate(campaign, request, actorUserId ?? request.requestedByUserId, now);
  }

  /** Resuming a campaign that had started: its templates may have changed while it was paused. */
  async stillValid(campaign: Campaign, now: Date): Promise<boolean> {
    if (!campaign.approvalRequestId) return false;
    const request = await this.prisma.approvalRequest.findFirst({ where: { id: campaign.approvalRequestId, studioId: campaign.studioId } });
    if (!request || !isGrantedApprovalStatus(request.status)) return false;
    const print = await this.precheck.fingerprint(campaign, asSummary(request.summary).requestedSchedule, now);
    return print.contentHash === request.contentHash;
  }

  /** The campaign changed after its request: the old request is CANCELLED (marked invalidated) and a new PENDING one replaces it. */
  async invalidate(campaign: Campaign, old: ApprovalRequest, actorUserId: string, now: Date): Promise<ApprovalRequest> {
    const settings = await this.settings.get(campaign.studioId);
    const oldSummary = asSummary(old.summary);
    const check = await this.precheck.run(campaign, oldSummary.requestedSchedule, settings, now);
    const created = await this.prisma.$transaction(async (tx) => {
      const next = await tx.approvalRequest.create({
        data: {
          studioId: campaign.studioId,
          targetType: 'CAMPAIGN',
          targetId: campaign.id,
          contentHash: check.contentHash,
          summary: check.summary as unknown as Prisma.InputJsonValue,
          status: 'PENDING',
          requestedByUserId: actorUserId,
          expiresAt: approvalExpiresAt(now, settings.approvalTtlHours),
          createdAt: now,
        },
      });
      await this.supersede(tx, campaign, next.id, 'CONTENT_CHANGED', now);
      await tx.campaign.update({
        where: { id: campaign.id },
        data: { status: 'PENDING_APPROVAL', approvalRequestId: next.id },
      });
      await this.audit(tx, campaign.studioId, actorUserId, 'marketing.approval.invalidated', next, { campaignId: campaign.id, previousRequestId: old.id });
      return next;
    });
    await this.notifySuperAdmins(created, actorUserId);
    return created;
  }

  /** Heartbeat: PENDING requests past their TTL become EXPIRED and their campaigns go back to DRAFT. */
  async expireDue(now: Date): Promise<{ expired: number }> {
    const due = await this.prisma.approvalRequest.findMany({ where: { status: 'PENDING', expiresAt: { lte: now } }, take: 200 });
    let expired = 0;
    for (const request of due) {
      await this.prisma.$transaction(async (tx) => {
        const moved = await tx.approvalRequest.updateMany({ where: { id: request.id, status: 'PENDING' }, data: { status: 'EXPIRED', decidedAt: now } });
        if (moved.count === 0) return;
        expired += 1;
        if (request.targetType === 'CAMPAIGN') {
          await tx.campaign.updateMany({ where: { id: request.targetId, studioId: request.studioId, approvalRequestId: request.id, status: 'PENDING_APPROVAL' }, data: { status: 'DRAFT' } });
        } else {
          await this.targetHandlers.get(request.targetType)?.onClosed(tx, request, 'EXPIRED');
        }
        await this.audit(tx, request.studioId, null, 'marketing.approval.expired', request, { targetId: request.targetId });
      });
    }
    return { expired };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private sendTime(schedule: string | null, now: Date): Date {
    const at = schedule ? new Date(schedule) : now;
    return at.getTime() > now.getTime() ? at : now;
  }

  private async campaign(studioId: string, id: string): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, studioId } });
    if (!campaign) throw new NotFoundException('Kampanya bulunamadı');
    return campaign;
  }

  private async targetCampaign(request: ApprovalRequest): Promise<Campaign> {
    const campaign = request.targetType === 'CAMPAIGN' ? await this.prisma.campaign.findFirst({ where: { id: request.targetId, studioId: request.studioId } }) : null;
    if (!campaign || campaign.approvalRequestId !== request.id || campaign.status !== 'PENDING_APPROVAL') {
      throw approvalError(HttpStatus.CONFLICT, 'APPROVAL_NOT_PENDING', 'Talep artık geçerli değil');
    }
    return campaign;
  }

  /** A PENDING request of the tenant; an expired one is marked EXPIRED on the spot. */
  private async pending(studioId: string, id: string, now: Date): Promise<ApprovalRequest> {
    const request = await this.prisma.approvalRequest.findFirst({ where: { id, studioId } });
    if (!request) throw new NotFoundException('Onay talebi bulunamadı');
    if (isApprovalExpired(request, now)) {
      await this.expireDue(now);
      throw approvalError(HttpStatus.CONFLICT, 'APPROVAL_EXPIRED', 'Onay talebinin süresi doldu');
    }
    if (request.status !== 'PENDING') throw approvalError(HttpStatus.CONFLICT, 'APPROVAL_NOT_PENDING', 'Talep bekleyen durumda değil');
    return request;
  }

  /** REJECTED or CANCELLED: the campaign goes back to DRAFT. */
  private async close(request: ApprovalRequest, actor: ApprovalActor, status: 'REJECTED' | 'CANCELLED', note: string | undefined, action: string, now: Date): Promise<ApprovalRequest> {
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.approvalRequest.updateMany({
        where: { id: request.id, status: 'PENDING' },
        data: { status, decidedByUserId: actor.userId, decidedAt: now, decisionNote: note?.trim() || null },
      });
      if (moved.count === 0) throw approvalError(HttpStatus.CONFLICT, 'APPROVAL_NOT_PENDING', 'Talep bekleyen durumda değil');
      if (request.targetType === 'CAMPAIGN') {
        await tx.campaign.updateMany({
          where: { id: request.targetId, studioId: request.studioId, approvalRequestId: request.id, status: 'PENDING_APPROVAL' },
          data: { status: 'DRAFT' },
        });
      } else {
        await this.targetHandlers.get(request.targetType)?.onClosed(tx, request, status);
      }
      const updated = await tx.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
      await this.audit(tx, request.studioId, actor.userId, action, updated, { targetId: request.targetId, note: note?.trim() || null });
      return updated;
    });
  }

  /** The campaign's previous open or granted request no longer applies (a new one replaces it). */
  private async supersede(tx: Tx, campaign: Campaign, replacedBy: string, reason: 'CONTENT_CHANGED' | 'RESUBMITTED', now: Date): Promise<void> {
    if (!campaign.approvalRequestId || campaign.approvalRequestId === replacedBy) return;
    const previous = await tx.approvalRequest.findFirst({ where: { id: campaign.approvalRequestId, studioId: campaign.studioId } });
    if (!previous || (previous.status !== 'PENDING' && !isGrantedApprovalStatus(previous.status))) return;
    const summary = asSummary(previous.summary);
    await tx.approvalRequest.update({
      where: { id: previous.id },
      data: {
        status: 'CANCELLED',
        decidedAt: previous.decidedAt ?? now,
        summary: { ...summary, invalidated: { at: now.toISOString(), reason, replacedByRequestId: replacedBy } } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async audit(tx: Tx, studioId: string, userId: string | null, action: string, request: ApprovalRequest, metadata: Record<string, unknown>): Promise<void> {
    await tx.auditLog.create({
      data: {
        studioId,
        userId,
        action,
        entityType: 'ApprovalRequest',
        entityId: request.id,
        metadata: { ...metadata, status: request.status, targetType: request.targetType } as Prisma.InputJsonValue,
      },
    });
  }

  private async toDto(row: ApprovalRequest, actor: ApprovalActor): Promise<ApprovalRequestDTO> {
    return (await this.toDtos([row], actor))[0];
  }

  private async toDtos(rows: ApprovalRequest[], actor: ApprovalActor): Promise<ApprovalRequestDTO[]> {
    const userIds = [...new Set(rows.flatMap((r) => [r.requestedByUserId, r.decidedByUserId]).filter((v): v is string => Boolean(v)))];
    const campaignIds = rows.filter((r) => r.targetType === 'CAMPAIGN').map((r) => r.targetId);
    const [users, campaigns] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, studioId: true, name: true, status: true } }),
    ]);
    const name = (id: string) => {
      const u = users.find((x) => x.id === id);
      return { id, name: u ? contactDisplayName(u) : '' };
    };
    return rows.map((r) => {
      const target = campaigns.find((c) => c.id === r.targetId && c.studioId === r.studioId);
      const pendingNow = r.status === 'PENDING';
      return {
        id: r.id,
        targetType: r.targetType as ApprovalTargetType,
        targetId: r.targetId,
        status: r.status as ApprovalStatus,
        contentHash: r.contentHash,
        summary: asSummary(r.summary),
        requestedBy: name(r.requestedByUserId),
        decidedBy: r.decidedByUserId ? name(r.decidedByUserId) : null,
        decisionNote: r.decisionNote,
        expiresAt: r.expiresAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        target: target ? { name: target.name, status: target.status } : null,
        canDecide: pendingNow && actor.isSuperAdmin,
        canCancel: pendingNow && (actor.isSuperAdmin || r.requestedByUserId === actor.userId),
      };
    });
  }

  // -- Notifications (transactional e-mail + in-app, through the messaging engine) --

  private link(requestId: string): string {
    const base = (this.config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
    return `${base}/pazarlama/onaylar?id=${encodeURIComponent(requestId)}`;
  }

  private translator(locale: string | null) {
    const code = locale && BUNDLED_MESSAGES[locale] ? locale : 'tr';
    return createTranslator({ locale: code, messages: BUNDLED_MESSAGES[code] ?? BASE_MESSAGES, fallback: BASE_MESSAGES });
  }

  private async notifySuperAdmins(request: ApprovalRequest, requesterId: string): Promise<void> {
    const [admins, requester] = await Promise.all([
      this.prisma.user.findMany({ where: { isSuperAdmin: true, isActive: true, id: { not: requesterId } }, select: { id: true, locale: true } }),
      this.prisma.user.findUnique({ where: { id: requesterId }, select: { firstName: true, lastName: true } }),
    ]);
    const summary = asSummary(request.summary);
    for (const admin of admins) {
      const t = this.translator(admin.locale);
      await this.deliver(request.studioId, admin.id, MARKETING_APPROVAL_TEMPLATE_KEYS.requested, {
        requesterName: requester ? contactDisplayName(requester) : '-',
        targetName: summary.target.name,
        audience: summary.audience.total,
        reasons: summary.reasons.map((r) => t(`marketingApprovals.reason.${r}`)).join(', ') || '-',
        link: this.link(request.id),
      });
    }
  }

  private async notifyRequester(request: ApprovalRequest, outcome: 'approved' | 'rejected'): Promise<void> {
    const decider = request.decidedByUserId
      ? await this.prisma.user.findUnique({ where: { id: request.decidedByUserId }, select: { firstName: true, lastName: true } })
      : null;
    await this.deliver(request.studioId, request.requestedByUserId, MARKETING_APPROVAL_TEMPLATE_KEYS[outcome], {
      targetName: asSummary(request.summary).target.name,
      deciderName: decider ? contactDisplayName(decider) : '-',
      note: request.decisionNote ?? '-',
      link: this.link(request.id),
    });
  }

  /** One e-mail and one in-app message; a failure is logged and never fails the decision. */
  private async deliver(studioId: string, userId: string, templateKey: string, variables: Record<string, string | number>): Promise<void> {
    for (const channel of ['EMAIL', 'IN_APP'] as const) {
      try {
        await this.messaging.send({
          studioId,
          recipient: { userId },
          channel,
          purpose: 'TRANSACTIONAL',
          templateKey,
          variables,
          type: templateKey,
          billing: 'EXEMPT',
        });
      } catch (err) {
        this.logger.warn(`Approval notice ${templateKey} (${channel}) not sent: ${err instanceof Error ? err.name : 'unknown'}`);
      }
    }
  }
}

