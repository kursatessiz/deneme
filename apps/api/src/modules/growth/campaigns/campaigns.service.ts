import { BadRequestException, ConflictException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Campaign, CampaignRecipientStatus } from '@platform/database';
import {
  CAMPAIGN_BATCH_SIZE,
  CAMPAIGN_QUIET_HOURS_MAX_DEFER_HOURS,
  CAP_DEFERRED_REASON_CODES,
  assignVariants,
  canPauseCampaign,
  canResumeCampaign,
  contactDisplayName,
  countryOfPhone,
  nextCapWindowStart,
  nextLocalTime,
  resolveRecipientTimeZone,
} from '@platform/shared';
import type {
  CampaignAbTestInput,
  CampaignDTO,
  CampaignSendTimeMode,
  CampaignVariantInput,
  PickCampaignWinnerInput,
  CampaignRecipientDTO,
  CampaignRecipientsQuery,
  CampaignStatsDTO,
  CampaignTestSendResultDTO,
  CreateCampaignInput,
  MessageChannelV2,
  ScheduleCampaignInput,
  UpdateCampaignInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagingService } from '../../messaging/engine/messaging.service';
import type { TenantContext } from '../../auth/tenant-context';
import { SegmentsService } from '../segments/segments.service';
import { GrowthQueueService } from '../growth-queue.service';
import { CampaignApprovalService, approvalError } from './approval/campaign-approval.service';
import { CampaignAbService, parseAbSetup, parseOverrides } from './campaign-ab.service';
import { CampaignSendTimeService } from './campaign-send-time.service';
import { MarketingGuardsService } from './marketing-guards.service';

const HOUR_MS = 60 * 60 * 1000;
/** A recipient being sent is leased for this long (concurrent workers). */
const LEASE_MS = 10 * 60 * 1000;
/** Batches one heartbeat processes per campaign. */
const BATCHES_PER_RUN = 5;
/** Conversion types counted as a campaign conversion and their value as revenue. */
const CONVERSION_TYPES = ['trial_booked', 'purchase', 'subscription_started', 'subscription_renewed'];
const REVENUE_TYPES = ['purchase', 'subscription_started', 'subscription_renewed'];

type CampaignWithSegment = Campaign & { segment: { name: string } | null };

/**
 * Campaigns (section 3.7, docs/KAMPANYA_VE_AKISLAR.md). A scheduled
 * campaign snapshots its segment into campaign_recipients when it starts
 * (one row per contact, unique), then sends in batches through
 * MessagingService.send() with the idempotency key campaign:<id>:<contact>,
 * so a retried batch or a second worker never sends twice. Campaigns are
 * always COMMERCIAL: consent, opt-out, quiet hours and the frequency cap of
 * the messaging engine decide per recipient; a recipient held by quiet
 * hours is retried when the recipient's day starts.
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly segments: SegmentsService,
    private readonly queue: GrowthQueueService,
    private readonly approvals: CampaignApprovalService,
    private readonly ab: CampaignAbService,
    private readonly sendTime: CampaignSendTimeService,
    private readonly guards: MarketingGuardsService,
  ) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async list(studioId: string): Promise<CampaignDTO[]> {
    const rows = await this.prisma.campaign.findMany({
      where: { studioId },
      include: { segment: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  async get(studioId: string, id: string): Promise<CampaignWithSegment> {
    const row = await this.prisma.campaign.findFirst({ where: { id, studioId }, include: { segment: { select: { name: true } } } });
    if (!row) throw new NotFoundException('Kampanya bulunamadı');
    return row;
  }

  async detail(studioId: string, id: string): Promise<CampaignDTO> {
    return this.toDto(await this.get(studioId, id));
  }

  async create(tenant: TenantContext, input: CreateCampaignInput, actorUserId: string | null = null): Promise<CampaignDTO> {
    await this.segments.get(tenant.studioId, input.segmentId);
    const plan = await this.planAbAndTiming(tenant.studioId, null, input);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: {
          studioId: tenant.studioId,
          name: input.name,
          segmentId: input.segmentId,
          channel: input.channel ?? null,
          templateKey: input.templateKey,
          createdByMembershipId: tenant.membershipId,
          createdByUserId: actorUserId,
          abTest: plan.abTest ? (plan.abTest as Prisma.InputJsonValue) : Prisma.DbNull,
          sendTimeMode: plan.sendTimeMode,
          sendTimeLocal: plan.sendTimeLocal,
        },
        include: { segment: { select: { name: true } } },
      });
      if (plan.variants) await this.ab.replace(tx, tenant.studioId, created.id, plan.variants);
      return created;
    });
    return this.toDto(row);
  }

  /**
   * Platform tenant (M3b): a campaign waiting for approval may still be
   * edited; an edit that changes the approved content (segment, channel,
   * template) replaces the request with a new PENDING one.
   */
  async update(studioId: string, id: string, input: UpdateCampaignInput, actorUserId: string | null = null): Promise<CampaignDTO> {
    const campaign = await this.get(studioId, id);
    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED' && campaign.status !== 'PENDING_APPROVAL') {
      throw new ConflictException('Gönderimi başlamış kampanya değiştirilemez');
    }
    if (input.segmentId) await this.segments.get(studioId, input.segmentId);
    const plan = await this.planAbAndTiming(studioId, campaign, input);
    await this.prisma.$transaction(async (tx) => {
      await tx.campaign.update({
        where: { id: campaign.id },
        data: {
          name: input.name,
          segmentId: input.segmentId,
          channel: input.channel,
          templateKey: input.templateKey,
          ...(input.abTest !== undefined ? { abTest: plan.abTest ? (plan.abTest as Prisma.InputJsonValue) : Prisma.DbNull } : {}),
          sendTimeMode: plan.sendTimeMode,
          sendTimeLocal: plan.sendTimeLocal,
        },
      });
      if (plan.variants) await this.ab.replace(tx, studioId, campaign.id, plan.variants);
    });
    if (campaign.approvalRequestId && (await this.approvals.isPlatformStudio(studioId))) {
      await this.approvals.onCampaignChanged(campaign.id, actorUserId);
    }
    return this.detail(studioId, id);
  }

  async remove(studioId: string, id: string): Promise<{ deleted: true }> {
    const campaign = await this.get(studioId, id);
    if (campaign.status !== 'DRAFT') throw new ConflictException('Yalnızca taslak kampanyalar silinebilir');
    await this.prisma.campaign.delete({ where: { id: campaign.id } });
    return { deleted: true };
  }

  /**
   * Validates the A/B setup and the send time fields of a create or update
   * against what is stored: a test needs two or more variants, RECIPIENT_LOCAL
   * needs a local time, and a WhatsApp variant differs by template only (an
   * approved WhatsApp template is never rewritten). `variants` is null when the
   * stored ones stay; an empty array clears them.
   */
  private async planAbAndTiming(
    studioId: string,
    existing: Campaign | null,
    input: Pick<CreateCampaignInput, 'abTest' | 'variants' | 'sendTimeMode' | 'sendTimeLocal'> & { channel?: CreateCampaignInput['channel'] | null },
  ): Promise<{
    abTest: CampaignAbTestInput | null;
    variants: CampaignVariantInput[] | null;
    sendTimeMode: CampaignSendTimeMode;
    sendTimeLocal: string | null;
  }> {
    const storedSetup = existing ? parseAbSetup(existing.abTest) : null;
    const abTest = input.abTest !== undefined ? input.abTest : storedSetup;
    let variants: CampaignVariantInput[] | null = null;
    if (abTest === null) {
      if (input.variants) throw new BadRequestException('Varyantlar için A/B testi ayarı gerekir');
      // A test that is removed takes its variants with it.
      variants = existing ? [] : null;
    } else if (input.variants) {
      variants = input.variants;
    } else if (!existing || (await this.ab.variantsOf(existing.id)).length < 2) {
      throw new BadRequestException('A/B testi için en az iki varyant gerekir');
    }
    if (variants && variants.length > 0) {
      await this.ab.validate(studioId, variants);
      const channel = input.channel !== undefined ? input.channel : existing?.channel;
      if (channel === 'WHATSAPP' && variants.some((v) => v.overrides && Object.keys(v.overrides).length > 0 && !v.templateKey)) {
        throw new BadRequestException('WhatsApp varyantları ayrı bir şablonla farklılaşmalıdır');
      }
    }
    const sendTimeMode = input.sendTimeMode ?? existing?.sendTimeMode ?? 'FIXED';
    const requestedLocal = input.sendTimeLocal !== undefined ? input.sendTimeLocal : (existing?.sendTimeLocal ?? null);
    if (sendTimeMode === 'RECIPIENT_LOCAL' && !requestedLocal) throw new BadRequestException('Alıcı yerel saati için bir saat girilmelidir');
    return { abTest, variants, sendTimeMode, sendTimeLocal: sendTimeMode === 'FIXED' ? null : requestedLocal };
  }

  async schedule(studioId: string, id: string, input: ScheduleCampaignInput, now = new Date()): Promise<CampaignDTO> {
    const campaign = await this.get(studioId, id);
    // Platform tenant (M3b): only an approval (or a self-approval) schedules a send.
    if (await this.approvals.isPlatformStudio(studioId)) {
      throw approvalError(HttpStatus.CONFLICT, 'CAMPAIGN_APPROVAL_REQUIRED', 'Bu kampanya ancak onay talebiyle gönderilebilir');
    }
    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') throw new ConflictException('Kampanya zaten gönderiliyor veya bitti');
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : now;
    if (scheduledAt.getTime() < now.getTime() - 60_000) throw new BadRequestException('Geçmiş bir zamana planlanamaz');
    const updated = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'SCHEDULED', scheduledAt },
      include: { segment: { select: { name: true } } },
    });
    await this.queue.scheduleCampaign(updated.id, scheduledAt);
    return this.toDto(updated);
  }

  async cancel(studioId: string, id: string, now = new Date(), actorUserId: string | null = null): Promise<CampaignDTO> {
    const campaign = await this.get(studioId, id);
    if (!['SCHEDULED', 'SENDING', 'DRAFT', 'PENDING_APPROVAL', 'PAUSED'].includes(campaign.status)) {
      throw new ConflictException('Bu kampanya iptal edilemez');
    }
    const results = await this.prisma.$transaction([
      this.prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'CANCELLED', cancelledAt: now, pauseReason: null } }),
      this.prisma.campaignRecipient.updateMany({ where: { campaignId: campaign.id, status: 'PENDING' }, data: { status: 'CANCELLED', nextAttemptAt: null } }),
      // An open approval request of a cancelled campaign is closed with it (M3b).
      ...(campaign.approvalRequestId
        ? [
            this.prisma.approvalRequest.updateMany({
              where: { id: campaign.approvalRequestId, studioId, status: 'PENDING' },
              data: { status: 'CANCELLED', decidedAt: now, decidedByUserId: actorUserId },
            }),
          ]
        : []),
    ]);
    const closed = results[2];
    if (campaign.approvalRequestId && closed && 'count' in closed && closed.count > 0) {
      await this.prisma.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'marketing.approval.cancelled',
          entityType: 'ApprovalRequest',
          entityId: campaign.approvalRequestId,
          metadata: { campaignId: campaign.id, via: 'campaign_cancel' },
        },
      });
    }
    return this.detail(studioId, id);
  }

  /** Platform tenant (M3b): a paused campaign never sends; its pending recipients wait. */
  async pause(studioId: string, id: string, userId: string, now = new Date()): Promise<CampaignDTO> {
    const campaign = await this.get(studioId, id);
    if (!canPauseCampaign(campaign.status)) throw approvalError(HttpStatus.CONFLICT, 'CAMPAIGN_NOT_PAUSABLE', 'Yalnızca planlanmış veya gönderilen kampanya duraklatılabilir');
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.campaign.updateMany({ where: { id: campaign.id, status: campaign.status }, data: { status: 'PAUSED', pauseReason: null } });
      if (moved.count === 0) throw approvalError(HttpStatus.CONFLICT, 'CAMPAIGN_NOT_PAUSABLE', 'Kampanyanın durumu değişti');
      await tx.auditLog.create({
        data: { studioId, userId, action: 'marketing.campaign.paused', entityType: 'Campaign', entityId: campaign.id, metadata: { from: campaign.status, at: now.toISOString() } },
      });
    });
    return this.detail(studioId, id);
  }

  /**
   * Back to SCHEDULED (not started yet: the approval is checked again when it
   * starts) or SENDING (started: the approval must still match the content,
   * otherwise it goes to PENDING_APPROVAL with a new request).
   */
  async resume(studioId: string, id: string, userId: string, now = new Date()): Promise<CampaignDTO> {
    const campaign = await this.get(studioId, id);
    if (!canResumeCampaign(campaign.status)) throw approvalError(HttpStatus.CONFLICT, 'CAMPAIGN_NOT_RESUMABLE', 'Yalnızca duraklatılmış kampanya sürdürülebilir');
    if (campaign.startedAt && !(await this.approvals.stillValid(campaign, now))) {
      const request = campaign.approvalRequestId ? await this.prisma.approvalRequest.findFirst({ where: { id: campaign.approvalRequestId, studioId } }) : null;
      if (request) await this.approvals.invalidate(campaign, request, userId, now);
      else await this.prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'DRAFT' } });
      return this.detail(studioId, id);
    }
    const next = campaign.startedAt ? 'SENDING' : 'SCHEDULED';
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.campaign.updateMany({ where: { id: campaign.id, status: 'PAUSED' }, data: { status: next, pauseReason: null } });
      if (moved.count === 0) throw approvalError(HttpStatus.CONFLICT, 'CAMPAIGN_NOT_RESUMABLE', 'Kampanyanın durumu değişti');
      await tx.auditLog.create({
        data: { studioId, userId, action: 'marketing.campaign.resumed', entityType: 'Campaign', entityId: campaign.id, metadata: { to: next, at: now.toISOString() } },
      });
    });
    const at = campaign.scheduledAt && campaign.scheduledAt > now && !campaign.startedAt ? campaign.scheduledAt : now;
    await this.queue.scheduleCampaign(campaign.id, at);
    return this.detail(studioId, id);
  }

  /** Sends the campaign's message to the caller's own membership, through the engine, outside the campaign stats. */
  async testSend(tenant: TenantContext, id: string): Promise<CampaignTestSendResultDTO> {
    const campaign = await this.get(tenant.studioId, id);
    if (!tenant.membershipId) throw new BadRequestException('Test gönderimi için bu işletmede bir üyeliğiniz olmalı');
    const result = await this.messaging.send({
      studioId: tenant.studioId,
      recipient: { membershipId: tenant.membershipId },
      ...(campaign.channel ? { channel: campaign.channel as MessageChannelV2 } : {}),
      purpose: 'COMMERCIAL',
      templateKey: campaign.templateKey,
      type: 'CAMPAIGN_TEST',
    });
    return { success: result.success, channel: result.channel ?? null, reasonCode: result.success ? null : (result.reasonCode ?? null) };
  }

  async recipients(studioId: string, id: string, query: CampaignRecipientsQuery): Promise<{ items: CampaignRecipientDTO[]; total: number }> {
    const campaign = await this.get(studioId, id);
    const where: Prisma.CampaignRecipientWhereInput = { studioId, campaignId: campaign.id, ...(query.status ? { status: query.status } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.campaignRecipient.count({ where }),
      this.prisma.campaignRecipient.findMany({
        where,
        include: { contact: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        contactId: r.contactId,
        fullName: contactDisplayName(r.contact),
        status: r.status,
        reasonCode: r.reasonCode,
        channel: (r.channel as MessageChannelV2 | null) ?? null,
        sentAt: r.sentAt?.toISOString() ?? null,
        variantKey: r.variantKey,
        dueAt: r.status === 'PENDING' ? (r.nextAttemptAt?.toISOString() ?? null) : null,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /** Heartbeat: every campaign that is due to start or still sending. */
  async processDue(now: Date): Promise<{ campaigns: number; sent: number; skipped: number; failed: number }> {
    const due = await this.prisma.campaign.findMany({
      where: { OR: [{ status: 'SCHEDULED', scheduledAt: { lte: now } }, { status: 'SENDING' }] },
      select: { id: true },
      take: 50,
    });
    const totals = { campaigns: due.length, sent: 0, skipped: 0, failed: 0 };
    for (const { id } of due) {
      try {
        const r = await this.processCampaign(id, now, BATCHES_PER_RUN);
        totals.sent += r.sent;
        totals.skipped += r.skipped;
        totals.failed += r.failed;
      } catch (err) {
        this.logger.warn(`Campaign ${id} batch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return totals;
  }

  /** One queue job: start the campaign if due, then send up to `batches` batches. */
  async processCampaign(id: string, now: Date, batches = 1): Promise<{ sent: number; skipped: number; failed: number }> {
    const totals = { sent: 0, skipped: 0, failed: 0 };
    let campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) return totals;

    if (campaign.status === 'SCHEDULED' && campaign.scheduledAt && campaign.scheduledAt <= now) {
      // Platform tenant (M3b): the approval must still match the content before anything goes out.
      let approvedAudience: string[] | null = null;
      if (await this.approvals.isPlatformStudio(campaign.studioId)) {
        approvedAudience = await this.approvals.verifyForSend(campaign, now);
        if (!approvedAudience) return totals;
      }
      // Only one worker moves SCHEDULED -> SENDING and takes the audience snapshot.
      const claimed = await this.prisma.campaign.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'SENDING', startedAt: now } });
      if (claimed.count === 1) {
        const contactIds = approvedAudience ?? (await this.segments.memberIds(campaign.studioId, campaign.segmentId, now));
        await this.materialise(campaign, contactIds, now);
        await this.prisma.campaign.update({ where: { id }, data: { audienceCount: contactIds.length } });
      }
      campaign = await this.prisma.campaign.findUnique({ where: { id } });
      if (!campaign) return totals;
    }
    if (campaign.status !== 'SENDING') return totals;

    // A/B test (M3c): the variants (two or more) drive what each recipient gets; the held-back rest waits for the winner.
    const variantRows = parseAbSetup(campaign.abTest) ? await this.ab.variantsOf(id) : [];
    const abActive = variantRows.length >= 2;
    if (abActive) await this.ab.advance(campaign, now);
    const variants = new Map(variantRows.map((v) => [v.key, v]));
    // M3d: the platform tenant's daily caps (e-mail, SMS credits) with the warm-up plan; null when nothing is capped.
    const caps = (await this.approvals.isPlatformStudio(campaign.studioId)) ? await this.guards.trackerFor(campaign.studioId, now) : null;
    let capBlocked: 'EMAIL' | 'SMS' | null = null;

    for (let batch = 0; batch < batches && !capBlocked; batch += 1) {
      // A pause (or cancel) between batches stops the send at once.
      if (batch > 0) {
        const current = await this.prisma.campaign.findUnique({ where: { id }, select: { status: true } });
        if (current?.status !== 'SENDING') return totals;
      }
      const pending = await this.prisma.campaignRecipient.findMany({
        where: {
          campaignId: id,
          status: 'PENDING',
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          ...(abActive ? { variantKey: { not: null } } : {}),
        },
        include: { contact: { select: { timezone: true, countryCode: true, phone: true } } },
        orderBy: { createdAt: 'asc' },
        take: CAMPAIGN_BATCH_SIZE,
      });
      if (!pending.length) break;
      for (const recipient of pending) {
        capBlocked = caps?.blockedBy(campaign.channel) ?? null;
        if (capBlocked) break;
        const sent = await this.sendOne(campaign, recipient, now, variants);
        if (sent) {
          totals[sent.outcome] += 1;
          if (sent.outcome === 'sent') caps?.consume(sent.channel);
        }
      }
    }
    if (capBlocked) await this.deferForCap(campaign, capBlocked, abActive, now);

    // Recipients of the test (or all, without a test) that are due or scheduled; held-back ones are not.
    const scheduled = { campaignId: id, status: 'PENDING' as const, ...(abActive ? { variantKey: { not: null } } : {}) };
    let remaining = await this.prisma.campaignRecipient.findFirst({ where: scheduled, orderBy: { nextAttemptAt: { sort: 'asc', nulls: 'first' } }, select: { nextAttemptAt: true } });
    if (!remaining && abActive) {
      // The test is settled: decide when the wait is over, otherwise wake up when it ends.
      const current = await this.prisma.campaign.findUnique({ where: { id } });
      if (current && (await this.ab.advance(current, now))) {
        remaining = await this.prisma.campaignRecipient.findFirst({ where: scheduled, orderBy: { nextAttemptAt: { sort: 'asc', nulls: 'first' } }, select: { nextAttemptAt: true } });
      } else if (current && !(await this.ab.variantsOf(id)).some((v) => v.isWinner)) {
        const due = await this.ab.decisionDueAt(current);
        if (due) await this.queue.scheduleCampaign(id, due > now ? due : now);
        return totals;
      }
    }
    if (!remaining) {
      await this.prisma.campaign.updateMany({ where: { id, status: 'SENDING' }, data: { status: 'SENT', completedAt: now } });
    } else {
      await this.queue.scheduleCampaign(id, remaining.nextAttemptAt && remaining.nextAttemptAt > now ? remaining.nextAttemptAt : now);
    }
    return totals;
  }

  /**
   * The audience snapshot (one row per contact). With an A/B test every
   * recipient is assigned once, deterministically: the test share gets a
   * variant now, the rest is held back (no variant, not due) until the winner.
   * With a recipient-local or best-time send each recipient row carries its
   * own due instant; rows are written in chunks, never one job per recipient.
   */
  private async materialise(campaign: Campaign, contactIds: readonly string[], now: Date): Promise<void> {
    const variantKeys = parseAbSetup(campaign.abTest) ? (await this.ab.variantsOf(campaign.id)).map((v) => v.key) : [];
    const setup = parseAbSetup(campaign.abTest);
    const assignment =
      setup && variantKeys.length >= 2
        ? assignVariants({ campaignId: campaign.id, contactIds, variantKeys, testSharePercent: setup.testShare })
        : null;
    const timing = await this.sendTime.context(campaign, now);
    for (let i = 0; i < contactIds.length; i += 1000) {
      const chunk = contactIds.slice(i, i + 1000);
      const sendingNow = assignment ? chunk.filter((id) => assignment.get(id)) : chunk;
      const due = timing && sendingNow.length > 0 ? await this.sendTime.plan(timing, sendingNow) : null;
      await this.prisma.campaignRecipient.createMany({
        data: chunk.map((contactId) => ({
          studioId: campaign.studioId,
          campaignId: campaign.id,
          contactId,
          variantKey: assignment?.get(contactId) ?? null,
          nextAttemptAt: due?.get(contactId) ?? null,
        })),
        skipDuplicates: true,
      });
    }
  }

  /**
   * The campaign owner picks the winner now (by the metric, or an explicit
   * variant): the held-back audience receives it from the next batch on.
   */
  async pickWinner(studioId: string, id: string, input: PickCampaignWinnerInput, actorUserId: string | null = null, now = new Date()): Promise<CampaignDTO> {
    const campaign = await this.get(studioId, id);
    const variants = parseAbSetup(campaign.abTest) ? await this.ab.variantsOf(campaign.id) : [];
    if (variants.length < 2) throw new ConflictException('Bu kampanyada A/B testi yok');
    if (campaign.status !== 'SENDING') throw new ConflictException('Kazanan yalnızca test gönderimi sürerken seçilebilir');
    if (variants.some((v) => v.isWinner)) throw new ConflictException('Kazanan zaten seçildi');
    const key = await this.ab.decide(campaign, input.variantKey ?? null, now, actorUserId);
    if (!key) throw new ConflictException('Kazanan zaten seçildi');
    await this.queue.scheduleCampaign(campaign.id, now);
    return this.detail(studioId, id);
  }

  /**
   * A daily cap is full: the rest of the campaign waits for the next UTC day.
   * Every due recipient keeps PENDING with the next day as its due time and a
   * cap reason code (shown on the campaign); one audit entry per campaign and day.
   */
  private async deferForCap(campaign: Campaign, channel: 'EMAIL' | 'SMS', abActive: boolean, now: Date): Promise<void> {
    const until = nextCapWindowStart(now);
    const deferred = await this.prisma.campaignRecipient.updateMany({
      where: {
        campaignId: campaign.id,
        status: 'PENDING',
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        ...(abActive ? { variantKey: { not: null } } : {}),
      },
      data: { nextAttemptAt: until, reasonCode: CAP_DEFERRED_REASON_CODES[channel] },
    });
    if (deferred.count === 0) return;
    const dayStart = new Date(until.getTime() - 86_400_000);
    const already = await this.prisma.auditLog.findFirst({
      where: { studioId: campaign.studioId, action: 'marketing.campaign.cap_deferred', entityId: campaign.id, createdAt: { gte: dayStart } },
      select: { id: true },
    });
    if (already) return;
    await this.prisma.auditLog.create({
      data: {
        studioId: campaign.studioId,
        userId: null,
        action: 'marketing.campaign.cap_deferred',
        entityType: 'Campaign',
        entityId: campaign.id,
        createdAt: now,
        metadata: { channel, deferred: deferred.count, until: until.toISOString() },
      },
    });
  }

  private async sendOne(
    campaign: Campaign,
    recipient: {
      id: string;
      contactId: string;
      variantKey: string | null;
      nextAttemptAt: Date | null;
      contact: { timezone: string | null; countryCode: string | null; phone: string | null };
    },
    now: Date,
    variants: ReadonlyMap<string, { templateKey: string | null; templateOverrides: Prisma.JsonValue | null }>,
  ): Promise<{ outcome: 'sent' | 'skipped' | 'failed'; channel: string | null } | null> {
    // Lease the row; a concurrent worker that already took it gets count 0.
    const leased = await this.prisma.campaignRecipient.updateMany({
      where: { id: recipient.id, status: 'PENDING', nextAttemptAt: recipient.nextAttemptAt },
      data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
    });
    if (leased.count === 0) return null;

    // A/B variant (M3c): its own template and/or e-mail and SMS text overrides.
    const variant = recipient.variantKey ? variants.get(recipient.variantKey) : undefined;
    const templateKey = variant?.templateKey ?? campaign.templateKey;
    const overrides = variant ? parseOverrides(variant.templateOverrides) : null;
    const result = await this.messaging.send({
      studioId: campaign.studioId,
      recipient: { contactId: recipient.contactId },
      ...(campaign.channel ? { channel: campaign.channel as MessageChannelV2 } : {}),
      purpose: 'COMMERCIAL',
      templateKey,
      ...(overrides ? { overrides } : {}),
      idempotencyKey: `campaign:${campaign.id}:${recipient.contactId}`,
      campaignId: campaign.id,
      type: templateKey,
    });

    let status: CampaignRecipientStatus;
    let nextAttemptAt: Date | null = null;
    if (result.success) {
      status = 'SENT';
    } else if (
      result.reasonCode === 'QUIET_HOURS' &&
      now.getTime() - (campaign.startedAt ?? now).getTime() < CAMPAIGN_QUIET_HOURS_MAX_DEFER_HOURS * HOUR_MS
    ) {
      status = 'PENDING';
      const studio = await this.prisma.studio.findUnique({ where: { id: campaign.studioId }, select: { timezone: true } });
      // The same zone the engine judged quiet hours in: the contact's, their country's, the tenant's.
      const zone = resolveRecipientTimeZone({
        timezone: recipient.contact.timezone,
        countryCode: recipient.contact.countryCode ?? countryOfPhone(recipient.contact.phone),
        studioTimezone: studio?.timezone,
      });
      nextAttemptAt = nextLocalTime(now, '08:00', zone);
    } else {
      status = result.reasonCode === 'PROVIDER_ERROR' ? 'FAILED' : 'SKIPPED';
    }
    await this.prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status,
        nextAttemptAt,
        reasonCode: result.success ? (result.duplicate ? 'DUPLICATE' : null) : (result.reasonCode ?? 'UNKNOWN'),
        channel: result.channel ?? null,
        notificationLogId: result.notificationLogId ?? null,
        sentAt: result.success ? now : null,
      },
    });
    const outcome = status === 'SENT' ? 'sent' : status === 'FAILED' ? 'failed' : status === 'SKIPPED' ? 'skipped' : null;
    return outcome ? { outcome, channel: result.channel ?? null } : null;
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  async stats(campaign: Campaign): Promise<CampaignStatsDTO> {
    const [byStatus, byReason, delivered, opened, clicked, unsubscribed, studio, capDeferred] = await Promise.all([
      this.prisma.campaignRecipient.groupBy({ by: ['status'], where: { campaignId: campaign.id }, _count: { _all: true } }),
      this.prisma.campaignRecipient.groupBy({ by: ['reasonCode'], where: { campaignId: campaign.id, status: 'SKIPPED' }, _count: { _all: true } }),
      this.prisma.notificationLog.count({ where: { studioId: campaign.studioId, campaignId: campaign.id, OR: [{ deliveredAt: { not: null } }, { status: 'DELIVERED' }] } }),
      this.prisma.notificationLog.count({ where: { studioId: campaign.studioId, campaignId: campaign.id, openedAt: { not: null } } }),
      this.prisma.notificationLog.count({ where: { studioId: campaign.studioId, campaignId: campaign.id, clickedAt: { not: null } } }),
      this.prisma.messageTrackingEvent.count({ where: { studioId: campaign.studioId, type: 'UNSUBSCRIBE', notificationLog: { campaignId: campaign.id } } }),
      this.prisma.studio.findUnique({ where: { id: campaign.studioId }, select: { attributionWindowDays: true } }),
      this.prisma.campaignRecipient.aggregate({
        where: { campaignId: campaign.id, status: 'PENDING', reasonCode: { in: Object.values(CAP_DEFERRED_REASON_CODES) } },
        _count: { _all: true },
        _min: { nextAttemptAt: true },
      }),
    ]);
    const count = (s: CampaignRecipientStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const windowDays = studio?.attributionWindowDays ?? 30;

    const converted = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT r."contact_id")::bigint AS n
      FROM "campaign_recipients" r
      JOIN "conversion_events" e
        ON e."contact_id" = r."contact_id" AND e."studio_id" = r."studio_id"
       AND e."occurred_at" >= r."sent_at" AND e."occurred_at" <= r."sent_at" + (${windowDays}::int * interval '1 day')
       AND e."is_test" = false AND e."type" = ANY(${CONVERSION_TYPES})
      WHERE r."campaign_id" = ${campaign.id}::uuid AND r."studio_id" = ${campaign.studioId}::uuid AND r."status" = 'SENT'`;
    const revenueRows = await this.prisma.$queryRaw<{ currency: string; total: string }[]>`
      SELECT e."currency", round(sum(e."value_amount"), 2)::text AS total
      FROM "campaign_recipients" r
      JOIN "conversion_events" e
        ON e."contact_id" = r."contact_id" AND e."studio_id" = r."studio_id"
       AND e."occurred_at" >= r."sent_at" AND e."occurred_at" <= r."sent_at" + (${windowDays}::int * interval '1 day')
       AND e."is_test" = false AND e."type" = ANY(${REVENUE_TYPES}) AND e."currency" IS NOT NULL
      WHERE r."campaign_id" = ${campaign.id}::uuid AND r."studio_id" = ${campaign.studioId}::uuid AND r."status" = 'SENT'
      GROUP BY e."currency"`;

    return {
      audience: campaign.audienceCount,
      pending: count('PENDING'),
      sent: count('SENT'),
      skipped: count('SKIPPED'),
      failed: count('FAILED'),
      delivered,
      opened,
      clicked,
      unsubscribed,
      converted: Number(converted[0]?.n ?? 0),
      revenue: Object.fromEntries(revenueRows.map((r) => [r.currency, r.total])),
      skippedByReason: Object.fromEntries(byReason.map((b) => [b.reasonCode ?? 'UNKNOWN', b._count._all])),
      deferredByCap: capDeferred._count._all,
      deferredUntil: capDeferred._min.nextAttemptAt?.toISOString() ?? null,
    };
  }

  private async toDto(c: CampaignWithSegment): Promise<CampaignDTO> {
    const ab = await this.ab.describe(c, parseAbSetup(c.abTest) ? await this.ab.variantsOf(c.id) : []);
    return {
      id: c.id,
      name: c.name,
      segmentId: c.segmentId,
      segmentName: c.segment?.name ?? null,
      channel: (c.channel as MessageChannelV2 | null) ?? null,
      templateKey: c.templateKey,
      status: c.status,
      scheduledAt: c.scheduledAt?.toISOString() ?? null,
      startedAt: c.startedAt?.toISOString() ?? null,
      completedAt: c.completedAt?.toISOString() ?? null,
      cancelledAt: c.cancelledAt?.toISOString() ?? null,
      approvalRequestId: c.approvalRequestId,
      abTest: parseAbSetup(c.abTest),
      abPhase: ab.phase,
      variants: ab.variants,
      winnerKey: ab.winnerKey,
      sendTimeMode: c.sendTimeMode,
      sendTimeLocal: c.sendTimeLocal,
      pauseReason: c.pauseReason,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      stats: await this.stats(c),
    };
  }
}
