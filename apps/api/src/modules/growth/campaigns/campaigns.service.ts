import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Campaign, CampaignRecipientStatus } from '@platform/database';
import { CAMPAIGN_BATCH_SIZE, CAMPAIGN_QUIET_HOURS_MAX_DEFER_HOURS, contactDisplayName, nextLocalTime } from '@platform/shared';
import type {
  CampaignDTO,
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

  async create(tenant: TenantContext, input: CreateCampaignInput): Promise<CampaignDTO> {
    await this.segments.get(tenant.studioId, input.segmentId);
    const row = await this.prisma.campaign.create({
      data: {
        studioId: tenant.studioId,
        name: input.name,
        segmentId: input.segmentId,
        channel: input.channel ?? null,
        templateKey: input.templateKey,
        createdByMembershipId: tenant.membershipId,
      },
      include: { segment: { select: { name: true } } },
    });
    return this.toDto(row);
  }

  async update(studioId: string, id: string, input: UpdateCampaignInput): Promise<CampaignDTO> {
    const campaign = await this.get(studioId, id);
    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') throw new ConflictException('Gönderimi başlamış kampanya değiştirilemez');
    if (input.segmentId) await this.segments.get(studioId, input.segmentId);
    const row = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { name: input.name, segmentId: input.segmentId, channel: input.channel, templateKey: input.templateKey },
      include: { segment: { select: { name: true } } },
    });
    return this.toDto(row);
  }

  async remove(studioId: string, id: string): Promise<{ deleted: true }> {
    const campaign = await this.get(studioId, id);
    if (campaign.status !== 'DRAFT') throw new ConflictException('Yalnızca taslak kampanyalar silinebilir');
    await this.prisma.campaign.delete({ where: { id: campaign.id } });
    return { deleted: true };
  }

  async schedule(studioId: string, id: string, input: ScheduleCampaignInput, now = new Date()): Promise<CampaignDTO> {
    const campaign = await this.get(studioId, id);
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

  async cancel(studioId: string, id: string, now = new Date()): Promise<CampaignDTO> {
    const campaign = await this.get(studioId, id);
    if (campaign.status !== 'SCHEDULED' && campaign.status !== 'SENDING' && campaign.status !== 'DRAFT') {
      throw new ConflictException('Bu kampanya iptal edilemez');
    }
    await this.prisma.$transaction([
      this.prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'CANCELLED', cancelledAt: now } }),
      this.prisma.campaignRecipient.updateMany({ where: { campaignId: campaign.id, status: 'PENDING' }, data: { status: 'CANCELLED', nextAttemptAt: null } }),
    ]);
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
      // Only one worker moves SCHEDULED -> SENDING and takes the audience snapshot.
      const claimed = await this.prisma.campaign.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'SENDING', startedAt: now } });
      if (claimed.count === 1) {
        const contactIds = await this.segments.memberIds(campaign.studioId, campaign.segmentId, now);
        for (let i = 0; i < contactIds.length; i += 1000) {
          await this.prisma.campaignRecipient.createMany({
            data: contactIds.slice(i, i + 1000).map((contactId) => ({ studioId: campaign!.studioId, campaignId: id, contactId })),
            skipDuplicates: true,
          });
        }
        await this.prisma.campaign.update({ where: { id }, data: { audienceCount: contactIds.length } });
      }
      campaign = await this.prisma.campaign.findUnique({ where: { id } });
      if (!campaign) return totals;
    }
    if (campaign.status !== 'SENDING') return totals;

    for (let batch = 0; batch < batches; batch += 1) {
      const pending = await this.prisma.campaignRecipient.findMany({
        where: { campaignId: id, status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        include: { contact: { select: { timezone: true } } },
        orderBy: { createdAt: 'asc' },
        take: CAMPAIGN_BATCH_SIZE,
      });
      if (!pending.length) break;
      for (const recipient of pending) {
        const outcome = await this.sendOne(campaign, recipient, now);
        if (outcome) totals[outcome] += 1;
      }
    }

    const remaining = await this.prisma.campaignRecipient.findFirst({
      where: { campaignId: id, status: 'PENDING' },
      orderBy: { nextAttemptAt: { sort: 'asc', nulls: 'first' } },
      select: { nextAttemptAt: true },
    });
    if (!remaining) {
      await this.prisma.campaign.updateMany({ where: { id, status: 'SENDING' }, data: { status: 'SENT', completedAt: now } });
    } else {
      await this.queue.scheduleCampaign(id, remaining.nextAttemptAt && remaining.nextAttemptAt > now ? remaining.nextAttemptAt : now);
    }
    return totals;
  }

  private async sendOne(
    campaign: Campaign,
    recipient: { id: string; contactId: string; nextAttemptAt: Date | null; contact: { timezone: string | null } },
    now: Date,
  ): Promise<'sent' | 'skipped' | 'failed' | null> {
    // Lease the row; a concurrent worker that already took it gets count 0.
    const leased = await this.prisma.campaignRecipient.updateMany({
      where: { id: recipient.id, status: 'PENDING', nextAttemptAt: recipient.nextAttemptAt },
      data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
    });
    if (leased.count === 0) return null;

    const result = await this.messaging.send({
      studioId: campaign.studioId,
      recipient: { contactId: recipient.contactId },
      ...(campaign.channel ? { channel: campaign.channel as MessageChannelV2 } : {}),
      purpose: 'COMMERCIAL',
      templateKey: campaign.templateKey,
      idempotencyKey: `campaign:${campaign.id}:${recipient.contactId}`,
      campaignId: campaign.id,
      type: campaign.templateKey,
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
      nextAttemptAt = nextLocalTime(now, '08:00', recipient.contact.timezone ?? studio?.timezone ?? 'UTC');
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
    return status === 'SENT' ? 'sent' : status === 'FAILED' ? 'failed' : status === 'SKIPPED' ? 'skipped' : null;
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  async stats(campaign: Campaign): Promise<CampaignStatsDTO> {
    const [byStatus, byReason, delivered, opened, clicked, unsubscribed, studio] = await Promise.all([
      this.prisma.campaignRecipient.groupBy({ by: ['status'], where: { campaignId: campaign.id }, _count: { _all: true } }),
      this.prisma.campaignRecipient.groupBy({ by: ['reasonCode'], where: { campaignId: campaign.id, status: 'SKIPPED' }, _count: { _all: true } }),
      this.prisma.notificationLog.count({ where: { studioId: campaign.studioId, campaignId: campaign.id, OR: [{ deliveredAt: { not: null } }, { status: 'DELIVERED' }] } }),
      this.prisma.notificationLog.count({ where: { studioId: campaign.studioId, campaignId: campaign.id, openedAt: { not: null } } }),
      this.prisma.notificationLog.count({ where: { studioId: campaign.studioId, campaignId: campaign.id, clickedAt: { not: null } } }),
      this.prisma.messageTrackingEvent.count({ where: { studioId: campaign.studioId, type: 'UNSUBSCRIBE', notificationLog: { campaignId: campaign.id } } }),
      this.prisma.studio.findUnique({ where: { id: campaign.studioId }, select: { attributionWindowDays: true } }),
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
    };
  }

  private async toDto(c: CampaignWithSegment): Promise<CampaignDTO> {
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
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      stats: await this.stats(c),
    };
  }
}
