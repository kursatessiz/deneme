import { Injectable } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  CHANNEL_HEALTH_WINDOW_DAYS,
  DASHBOARD_CHANNEL_ROWS_MAX,
  DASHBOARD_LEAD_EVENT,
  DASHBOARD_PAID_EVENT,
  PLATFORM_B2B_FUNNEL_SLUG,
  READY_MADE_FUNNEL_PREFIX,
  aiBudgetOf,
  buildDashboardDeltas,
  costPerUnit,
  emailHealthOf,
  moneyList,
  planPriceIn,
  previousPeriodWindow,
  resolveDashboardRange,
  roasByCurrency,
  sanitizeConnectionError,
  smsHealthOf,
  studioBillingCurrency,
  summarizeTrialCohort,
} from '@platform/shared';
import type {
  AttributionGroupBy,
  AttributionReportRowDTO,
  DashboardBlock,
  DashboardChannelRow,
  DashboardHealth,
  DashboardMrr,
  DashboardQuery,
  MarketingDashboardDTO,
  Money,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { PlatformContext } from '../../auth/tenant-context';
import { AttributionService } from '../../crm/attribution/attribution.service';
import { FunnelsService } from '../../funnels/funnels.service';
import { AiUsageService } from '../../ai/ai-usage.service';

const DAY_MS = 86_400_000;
const PLATFORM_B2B_FUNNEL_ID = `${READY_MADE_FUNNEL_PREFIX}${PLATFORM_B2B_FUNNEL_SLUG}`;
const CONNECTION_ERROR_LIST_MAX = 50;

interface Range {
  from: Date;
  to: Date;
}

type SpendByKey = Map<string, Map<string, Prisma.Decimal>>;

function addDecimal(map: Map<string, Prisma.Decimal>, currency: string, amount: Prisma.Decimal): void {
  map.set(currency, (map.get(currency) ?? new Prisma.Decimal(0)).add(amount));
}

function decimalMoney(map: ReadonlyMap<string, Prisma.Decimal>): Money[] {
  return moneyList(new Map([...map].map(([currency, amount]) => [currency, amount.toFixed(2)])));
}

/**
 * The platform marketing dashboard (M3a, docs/PAZARLAMA_MODULU.md 3.3):
 * read-only aggregates of the platform tenant. Nothing here returns a
 * person; every query is filtered by the platform studio id resolved by the
 * platform guard. The funnel runs through the existing funnel query engine
 * (`platform_b2b`, MQL and SQL are pipeline stages), spend and revenue come
 * from AdSpendDaily and the attribution report, and money stays per currency.
 */
@Injectable()
export class MarketingDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly funnels: FunnelsService,
    private readonly attribution: AttributionService,
    private readonly aiUsage: AiUsageService,
  ) {}

  async dashboard(platform: PlatformContext, query: DashboardQuery, now = new Date()): Promise<MarketingDashboardDTO> {
    const range = resolveDashboardRange(query, now);
    const studioId = platform.platformStudioId;
    const current = await this.block(studioId, range);
    let previous: DashboardBlock | null = null;
    if (query.compare === 'previous') previous = await this.block(studioId, previousPeriodWindow(range));

    const canSeeRevenue = platform.isSuperAdmin || platform.permissions.has('platform.referrals.view');
    return {
      generatedAt: now.toISOString(),
      current,
      previous,
      deltas: previous ? buildDashboardDeltas(current, previous) : null,
      ...(canSeeRevenue ? { mrr: await this.mrr(range) } : {}),
      health: await this.health(studioId, range, now),
    };
  }

  private async block(studioId: string, range: Range): Promise<DashboardBlock> {
    const reportRange = { from: range.from.toISOString(), to: range.to.toISOString() };
    const [funnel, bySourceReport, byCampaignReport, spendRows, trialRows] = await Promise.all([
      this.funnels.reportForStudio(studioId, PLATFORM_B2B_FUNNEL_ID, range),
      this.attribution.report(studioId, { model: 'LAST_TOUCH', groupBy: 'source', ...reportRange }),
      this.attribution.report(studioId, { model: 'LAST_TOUCH', groupBy: 'campaign', ...reportRange }),
      // Campaign level only: a campaign's spend already includes its ad sets and ads.
      this.prisma.adSpendDaily.findMany({ where: { studioId, level: 'CAMPAIGN', date: { gte: range.from, lt: range.to } } }),
      this.prisma.studio.findMany({
        where: { isPlatform: false, trialStartedAt: { gte: range.from, lte: range.to } },
        select: { trialStartedAt: true, activatedAt: true },
      }),
    ]);

    const totalSpend = new Map<string, Prisma.Decimal>();
    const spendBySource: SpendByKey = new Map();
    const spendByCampaign: SpendByKey = new Map();
    for (const row of spendRows) {
      addDecimal(totalSpend, row.currency, row.spendAmount);
      for (const [map, key] of [
        [spendBySource, row.platform.toLowerCase()],
        [spendByCampaign, row.externalId],
      ] as const) {
        const byCurrency = map.get(key) ?? new Map<string, Prisma.Decimal>();
        addDecimal(byCurrency, row.currency, row.spendAmount);
        map.set(key, byCurrency);
      }
    }

    // The platform tenant's only value-bearing conversion is studio_paid, so the report's revenue is the paid value.
    const totals = bySourceReport.totals;
    const leads = Math.round(totals.conversions[DASHBOARD_LEAD_EVENT] ?? 0);
    const studioPaid = Math.round(totals.conversions[DASHBOARD_PAID_EVENT] ?? 0);
    const spend = decimalMoney(totalSpend);
    const revenue = moneyList(totals.revenue);

    const trial = summarizeTrialCohort(
      trialRows.flatMap((r) => (r.trialStartedAt ? [{ trialStartedAt: r.trialStartedAt, activatedAt: r.activatedAt }] : [])),
    );

    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      funnel: {
        id: funnel.funnel.id,
        windowDays: funnel.funnel.windowDays,
        steps: funnel.steps.map((s) => ({
          key: s.key,
          reached: s.reached,
          rateFromPrevious: s.rateFromPrevious,
          rateFromFirst: s.rateFromFirst,
          medianSecondsFromPrevious: s.medianSecondsFromPrevious,
        })),
      },
      acquisition: {
        leads,
        studioPaid,
        spend,
        revenue,
        cac: costPerUnit(spend, studioPaid, 'cac'),
        cpl: costPerUnit(spend, leads, 'cpl'),
        roas: roasByCurrency(revenue, spend),
      },
      trial,
      channels: {
        bySource: await this.channelRows('source', bySourceReport.rows, spendBySource, studioId),
        byCampaign: await this.channelRows('campaign', byCampaignReport.rows, spendByCampaign, studioId),
      },
    };
  }

  /** Rows of the attribution report joined with the spend of the same key; a key with spend but no conversion still shows (return 0). */
  private async channelRows(
    groupBy: AttributionGroupBy,
    reportRows: readonly AttributionReportRowDTO[],
    spendByKey: SpendByKey,
    studioId: string,
  ): Promise<DashboardChannelRow[]> {
    const byKey = new Map(reportRows.map((r) => [r.key, r]));
    const keys = new Set([...byKey.keys(), ...spendByKey.keys()]);
    const rows = [...keys]
      .map((key) => {
        const row = byKey.get(key);
        const spend = decimalMoney(spendByKey.get(key) ?? new Map());
        const revenue = moneyList(row?.revenue ?? {});
        return { key, studioPaid: row?.conversions[DASHBOARD_PAID_EVENT] ?? 0, spend, revenue, roas: roasByCurrency(revenue, spend) };
      })
      .filter((r) => r.studioPaid > 0 || r.spend.length > 0)
      .sort((a, b) => b.studioPaid - a.studioPaid || a.key.localeCompare(b.key))
      .slice(0, DASHBOARD_CHANNEL_ROWS_MAX);

    const names = new Map<string, string>();
    if (groupBy === 'campaign' && rows.length > 0) {
      const entities = await this.prisma.adEntity.findMany({
        where: { studioId, level: 'CAMPAIGN', externalId: { in: rows.map((r) => r.key) } },
        select: { externalId: true, name: true },
      });
      for (const e of entities) names.set(e.externalId, e.name);
    }
    return rows.map((r) => ({ ...r, studioPaid: Math.round(r.studioPaid * 10_000) / 10_000, label: names.get(r.key) ?? null }));
  }

  /** MRR impact from plan list prices in each studio's billing currency (only for platform.referrals.view or the super admin). */
  private async mrr(range: Range): Promise<DashboardMrr> {
    const studios = await this.prisma.studio.findMany({
      where: { isPlatform: false, billingStatus: 'ACTIVE', activatedAt: { not: null } },
      select: {
        countryCode: true,
        billingCurrency: true,
        activatedAt: true,
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { plan: { select: { prices: { select: { currency: true, priceMonthly: true } } } } },
        },
      },
    });
    const active = new Map<string, Prisma.Decimal>();
    const added = new Map<string, Prisma.Decimal>();
    let newPayingStudios = 0;
    let unpricedStudios = 0;
    for (const studio of studios) {
      const activatedInRange = studio.activatedAt !== null && studio.activatedAt >= range.from && studio.activatedAt <= range.to;
      if (activatedInRange) newPayingStudios += 1;
      const currency = studioBillingCurrency(studio);
      const price = planPriceIn(studio.subscriptions[0]?.plan.prices ?? [], currency);
      if (!price) {
        unpricedStudios += 1;
        continue;
      }
      addDecimal(active, currency, price.priceMonthly);
      if (activatedInRange) addDecimal(added, currency, price.priceMonthly);
    }
    return { activeMrr: decimalMoney(active), newMrr: decimalMoney(added), newPayingStudios, unpricedStudios };
  }

  private async health(studioId: string, range: Range, now: Date): Promise<DashboardHealth> {
    const email: DashboardHealth['email'] = [];
    const sms: DashboardHealth['sms'] = [];
    for (const days of CHANNEL_HEALTH_WINDOW_DAYS) {
      const window = { studioId, createdAt: { gt: new Date(range.to.getTime() - days * DAY_MS), lte: range.to } };
      const [sent, bounced, complained, attempted, delivered] = await Promise.all([
        this.prisma.notificationLog.count({
          where: { ...window, channel: 'EMAIL', OR: [{ status: { in: ['SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED'] } }, { bouncedAt: { not: null } }, { complainedAt: { not: null } }] },
        }),
        this.prisma.notificationLog.count({ where: { ...window, channel: 'EMAIL', OR: [{ status: 'BOUNCED' }, { bouncedAt: { not: null } }] } }),
        this.prisma.notificationLog.count({ where: { ...window, channel: 'EMAIL', OR: [{ status: 'COMPLAINED' }, { complainedAt: { not: null } }] } }),
        this.prisma.notificationLog.count({ where: { ...window, channel: 'SMS', status: { not: 'PENDING' } } }),
        this.prisma.notificationLog.count({ where: { ...window, channel: 'SMS', OR: [{ status: 'DELIVERED' }, { deliveredAt: { not: null } }] } }),
      ]);
      email.push(emailHealthOf(days, sent, bounced, complained));
      sms.push(smsHealthOf(days, attempted, delivered));
    }

    const ai = await this.aiUsage.marketingStatus(studioId, true, now);
    const [errorCount, connections, failedDeliveries] = await Promise.all([
      this.prisma.adConnection.count({ where: { studioId, lastError: { not: null } } }),
      this.prisma.adConnection.findMany({
        where: { studioId, lastError: { not: null } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: CONNECTION_ERROR_LIST_MAX,
        select: { id: true, platform: true, label: true, status: true, lastError: true, lastSyncAt: true },
      }),
      this.prisma.conversionDelivery.count({ where: { studioId, status: 'FAILED', createdAt: { gte: range.from, lte: range.to } } }),
    ]);

    return {
      email,
      sms,
      ai: aiBudgetOf(ai.budgetCents, ai.usedMicroUsd),
      // The approval model arrives with M3b; until then the tile reports "not available" instead of a misleading zero.
      approvals: { available: false, pending: 0 },
      connections: {
        errorCount,
        items: connections.map((c) => ({
          id: c.id,
          platform: c.platform,
          label: c.label,
          status: c.status,
          lastError: sanitizeConnectionError(c.lastError ?? ''),
          lastSyncAt: c.lastSyncAt ? c.lastSyncAt.toISOString() : null,
        })),
        failedDeliveries,
      },
    };
  }
}
