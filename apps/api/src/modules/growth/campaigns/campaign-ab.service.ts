import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Campaign, CampaignVariant } from '@platform/database';
import { CampaignAbTestSchema, CampaignVariantOverridesSchema, pickWinnerKey } from '@platform/shared';
import type {
  CampaignAbPhase,
  CampaignAbTestInput,
  CampaignVariantDTO,
  CampaignVariantInput,
  CampaignVariantOverrides,
  VariantStats,
  VariantStatsRow,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CampaignSendTimeService } from './campaign-send-time.service';
import { apiError } from '../../../common/api-error';

const MINUTE_MS = 60 * 1000;
const RELEASE_CHUNK = 1000;
/** Conversion types counted per variant; same set and window as the campaign stats. */
const CONVERSION_TYPES = ['trial_booked', 'purchase', 'subscription_started', 'subscription_renewed'];

type Tx = Prisma.TransactionClient;

export function parseAbSetup(value: Prisma.JsonValue | null | undefined): CampaignAbTestInput | null {
  if (value === null || value === undefined) return null;
  const parsed = CampaignAbTestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseOverrides(value: Prisma.JsonValue | null | undefined): CampaignVariantOverrides | null {
  if (value === null || value === undefined) return null;
  const parsed = CampaignVariantOverridesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The A/B test of a campaign (M3c, docs/PAZARLAMA_MODULU.md 4.3 item 2):
 * variants are stored per campaign; the test share and the held-back rest are
 * decided when the audience is snapshotted (CampaignsService); this service
 * validates and stores the setup, measures the variants, chooses the winner
 * (automatically after the wait, or by the owner) and releases the held-back
 * recipients with the winner. Sends still go through the messaging engine, so
 * consent, quiet hours and the frequency cap apply to every variant.
 */
@Injectable()
export class CampaignAbService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sendTime: CampaignSendTimeService,
  ) {}

  variantsOf(campaignId: string): Promise<CampaignVariant[]> {
    return this.prisma.campaignVariant.findMany({ where: { campaignId }, orderBy: { key: 'asc' } });
  }

  /** Checks the setup against the tenant's data (templates, AI drafts) before it is stored. */
  async validate(studioId: string, variants: readonly CampaignVariantInput[]): Promise<void> {
    for (const v of variants) {
      if (v.templateKey) {
        const exists = await this.prisma.messageTemplate.count({ where: { key: v.templateKey, isActive: true, OR: [{ studioId }, { studioId: null }] } });
        if (exists === 0) throw new BadRequestException(apiError('apiErrors.growth.variantTemplateNotFound', { variant: v.key, template: v.templateKey }));
      }
      if (v.aiDraftId) {
        const draft = await this.prisma.marketingDraft.count({ where: { id: v.aiDraftId, studioId } });
        if (draft === 0) throw new BadRequestException(apiError('apiErrors.growth.variantDraftNotFound', { variant: v.key }));
      }
    }
  }

  /** Replaces the stored variants of a campaign (an edit before the send starts). */
  async replace(tx: Tx, studioId: string, campaignId: string, variants: readonly CampaignVariantInput[]): Promise<void> {
    await tx.campaignVariant.deleteMany({ where: { campaignId, studioId } });
    if (variants.length === 0) return;
    await tx.campaignVariant.createMany({
      data: variants.map((v) => ({
        studioId,
        campaignId,
        key: v.key,
        templateKey: v.templateKey ?? null,
        templateOverrides: v.overrides && Object.keys(v.overrides).length > 0 ? (v.overrides as Prisma.InputJsonValue) : Prisma.DbNull,
        aiDraftId: v.aiDraftId ?? null,
      })),
    });
  }

  // ---------------------------------------------------------------------------
  // Measuring
  // ---------------------------------------------------------------------------

  /** Counts per variant from the recipients that were sent that variant, one row per stored variant. */
  async variantStats(campaign: Pick<Campaign, 'id' | 'studioId'>, variantKeys: readonly string[]): Promise<VariantStatsRow[]> {
    const [engagement, converted] = await Promise.all([
      this.prisma.$queryRaw<{ key: string; sent: number; opened: number; clicked: number }[]>`
        SELECT r."variant_key" AS key,
               (count(*) FILTER (WHERE r."status" = 'SENT'))::int AS sent,
               (count(*) FILTER (WHERE r."status" = 'SENT' AND l."opened_at" IS NOT NULL))::int AS opened,
               (count(*) FILTER (WHERE r."status" = 'SENT' AND l."clicked_at" IS NOT NULL))::int AS clicked
        FROM "campaign_recipients" r
        LEFT JOIN "notification_logs" l ON l."id" = r."notification_log_id"
        WHERE r."campaign_id" = ${campaign.id}::uuid AND r."studio_id" = ${campaign.studioId}::uuid AND r."variant_key" IS NOT NULL
        GROUP BY r."variant_key"`,
      this.conversionsByVariant(campaign),
    ]);
    return variantKeys.map((key) => {
      const row = engagement.find((e) => e.key === key);
      return { key, sent: row?.sent ?? 0, opened: row?.opened ?? 0, clicked: row?.clicked ?? 0, converted: converted.get(key) ?? 0 };
    });
  }

  private async conversionsByVariant(campaign: Pick<Campaign, 'id' | 'studioId'>): Promise<Map<string, number>> {
    const window = await this.prisma.studio.findUnique({ where: { id: campaign.studioId }, select: { attributionWindowDays: true } });
    const windowDays = window?.attributionWindowDays ?? 30;
    const rows = await this.prisma.$queryRaw<{ key: string; n: number }[]>`
      SELECT r."variant_key" AS key, count(DISTINCT r."contact_id")::int AS n
      FROM "campaign_recipients" r
      JOIN "conversion_events" e
        ON e."contact_id" = r."contact_id" AND e."studio_id" = r."studio_id"
       AND e."occurred_at" >= r."sent_at" AND e."occurred_at" <= r."sent_at" + (${windowDays}::int * interval '1 day')
       AND e."is_test" = false AND e."type" = ANY(${CONVERSION_TYPES})
      WHERE r."campaign_id" = ${campaign.id}::uuid AND r."studio_id" = ${campaign.studioId}::uuid
        AND r."status" = 'SENT' AND r."variant_key" IS NOT NULL
      GROUP BY r."variant_key"`;
    return new Map(rows.map((r) => [r.key, r.n]));
  }

  /** Where the test stands: live counts while it runs, the cache written at the decision afterwards. */
  async describe(campaign: Campaign, variants: readonly CampaignVariant[]): Promise<{ phase: CampaignAbPhase | null; winnerKey: string | null; variants: CampaignVariantDTO[] }> {
    const setup = parseAbSetup(campaign.abTest);
    const winner = variants.find((v) => v.isWinner) ?? null;
    if (!setup || variants.length === 0) return { phase: null, winnerKey: null, variants: variants.map((v) => this.toDto(v, null)) };
    const started = Boolean(campaign.startedAt);
    const live = started && !winner ? await this.variantStats(campaign, variants.map((v) => v.key)) : null;
    const dtos = variants.map((v) => {
      const cached = parseCachedStats(v.stats);
      const row = live?.find((r) => r.key === v.key);
      return this.toDto(v, row ? { sent: row.sent, opened: row.opened, clicked: row.clicked, converted: row.converted } : cached);
    });
    let phase: CampaignAbPhase = 'NOT_STARTED';
    if (winner) phase = 'DECIDED';
    else if (started) phase = (await this.pendingTestCount(campaign.id)) > 0 ? 'TEST' : 'WAITING';
    return { phase, winnerKey: winner?.key ?? null, variants: dtos };
  }

  private toDto(v: CampaignVariant, stats: VariantStats | null): CampaignVariantDTO {
    return {
      id: v.id,
      key: v.key,
      templateKey: v.templateKey,
      overrides: parseOverrides(v.templateOverrides),
      aiDraftId: v.aiDraftId,
      isWinner: v.isWinner,
      stats,
    };
  }

  // ---------------------------------------------------------------------------
  // The decision
  // ---------------------------------------------------------------------------

  private pendingTestCount(campaignId: string): Promise<number> {
    return this.prisma.campaignRecipient.count({ where: { campaignId, status: 'PENDING', variantKey: { not: null } } });
  }

  /** When the wait ends (last test message sent + waitMinutes); null while a test recipient is still pending or no test runs. */
  async decisionDueAt(campaign: Campaign): Promise<Date | null> {
    const setup = parseAbSetup(campaign.abTest);
    if (!setup || !campaign.startedAt) return null;
    if ((await this.pendingTestCount(campaign.id)) > 0) return null;
    const last = await this.prisma.campaignRecipient.aggregate({ where: { campaignId: campaign.id, variantKey: { not: null } }, _max: { sentAt: true } });
    return new Date((last._max.sentAt ?? campaign.startedAt).getTime() + setup.waitMinutes * MINUTE_MS);
  }

  /** Heartbeat step: chooses the winner once the test is settled and the wait is over. True when it decided now. */
  async advance(campaign: Campaign, now: Date): Promise<boolean> {
    if (!parseAbSetup(campaign.abTest) || campaign.status !== 'SENDING') return false;
    const variants = await this.variantsOf(campaign.id);
    if (variants.length === 0 || variants.some((v) => v.isWinner)) return false;
    const due = await this.decisionDueAt(campaign);
    if (!due || due > now) return false;
    return (await this.decide(campaign, null, now)) !== null;
  }

  /**
   * Chooses the winner (by the metric, or `requestedKey` when the owner picks),
   * records it with a stats cache on every variant and releases the held-back
   * recipients with the winner. Returns the key, or null when a winner already
   * exists (another worker or the owner was first).
   */
  async decide(campaign: Campaign, requestedKey: string | null, now: Date, actorUserId: string | null = null): Promise<string | null> {
    const setup = parseAbSetup(campaign.abTest);
    if (!setup) throw new ConflictException(apiError('apiErrors.growth.campaignHasNoAbTest'));
    const variants = await this.variantsOf(campaign.id);
    if (variants.length === 0) throw new ConflictException(apiError('apiErrors.growth.campaignNoVariants'));
    if (requestedKey && !variants.some((v) => v.key === requestedKey)) throw new BadRequestException(apiError('apiErrors.growth.noSuchVariantExists'));
    const rows = await this.variantStats(campaign, variants.map((v) => v.key));
    const winnerKey = requestedKey ?? pickWinnerKey(rows, setup.metric);
    if (!winnerKey) return null;

    const claimed = await this.prisma.$transaction(async (tx) => {
      const marked = await tx.campaignVariant.updateMany({
        where: { campaignId: campaign.id, key: winnerKey, isWinner: false, campaign: { variants: { none: { isWinner: true } } } },
        data: { isWinner: true },
      });
      if (marked.count === 0) return false;
      for (const row of rows) {
        await tx.campaignVariant.updateMany({
          where: { campaignId: campaign.id, key: row.key },
          data: { stats: { sent: row.sent, opened: row.opened, clicked: row.clicked, converted: row.converted } as Prisma.InputJsonValue },
        });
      }
      await tx.auditLog.create({
        data: {
          studioId: campaign.studioId,
          userId: actorUserId,
          action: 'campaign.ab.winner',
          entityType: 'Campaign',
          entityId: campaign.id,
          metadata: { winnerKey, metric: setup.metric, manual: requestedKey !== null, at: now.toISOString() } as Prisma.InputJsonValue,
        },
      });
      return true;
    });
    if (!claimed) return null;
    await this.release(campaign, winnerKey, now);
    return winnerKey;
  }

  /**
   * Gives every held-back recipient the winner and its due time (immediately
   * for FIXED; per recipient clock otherwise, one update per due instant so a
   * large audience is never touched row by row).
   */
  private async release(campaign: Campaign, winnerKey: string, now: Date): Promise<void> {
    const ctx = await this.sendTime.context(campaign, now);
    for (;;) {
      const held = await this.prisma.campaignRecipient.findMany({
        where: { campaignId: campaign.id, studioId: campaign.studioId, status: 'PENDING', variantKey: null },
        select: { id: true, contactId: true },
        orderBy: { id: 'asc' },
        take: RELEASE_CHUNK,
      });
      if (held.length === 0) return;
      if (!ctx) {
        await this.prisma.campaignRecipient.updateMany({ where: { id: { in: held.map((h) => h.id) } }, data: { variantKey: winnerKey, nextAttemptAt: null } });
        continue;
      }
      const due = await this.sendTime.plan(ctx, held.map((h) => h.contactId));
      const byInstant = new Map<number, string[]>();
      for (const h of held) {
        const at = (due.get(h.contactId) ?? now).getTime();
        const list = byInstant.get(at);
        if (list) list.push(h.id);
        else byInstant.set(at, [h.id]);
      }
      for (const [at, ids] of byInstant) {
        await this.prisma.campaignRecipient.updateMany({ where: { id: { in: ids } }, data: { variantKey: winnerKey, nextAttemptAt: new Date(at) } });
      }
    }
  }
}

function parseCachedStats(value: Prisma.JsonValue | null): VariantStats | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return { sent: n(v.sent), opened: n(v.opened), clicked: n(v.clicked), converted: n(v.converted) };
}
