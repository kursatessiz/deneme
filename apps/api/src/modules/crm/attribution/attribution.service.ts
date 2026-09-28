import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Touchpoint } from '@platform/database';
import { CAC_ACQUISITION_EVENT_TYPES, computeCac, computeCpl, computeRoas, DEFAULT_ATTRIBUTION_WINDOW_DAYS } from '@platform/shared';
import type {
  AdEntityLevel,
  AttributionGroupBy,
  AttributionReportDTO,
  AttributionReportQuery,
  AttributionReportRowDTO,
  ConversionEventType,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { creditConversion, pickFirstTouch, pickLastTouch, touchSummary } from './attribution-models';
import type { TouchSummary } from './attribution-models';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which AdSpendDaily level a report grouping matches spend against.
 * "source" rolls up to campaign-level spend by platform (summing ad-set or
 * ad-level rows too would triple count the same money, since one campaign's
 * spend is already the sum of its ad sets' and ads').
 */
const SPEND_LEVEL_BY_GROUP_BY: Record<AttributionGroupBy, AdEntityLevel> = {
  source: 'CAMPAIGN',
  campaign: 'CAMPAIGN',
  adset: 'ADSET',
  ad: 'AD',
};

/**
 * Visitor identification and attribution (docs/CRM_VE_ATIF.md).
 * identify() runs server side when a form, booking or sign-up creates or
 * finds a Contact and the request carries the pw_vid visitor id: the
 * visitor's touchpoints are attached to the contact and its first/last
 * touch summary is refreshed.
 */
@Injectable()
export class AttributionService {
  private readonly logger = new Logger(AttributionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attribution window in days, a tenant setting (Studio.attributionWindowDays,
   * G2b; default DEFAULT_ATTRIBUTION_WINDOW_DAYS = 30). Replaces the
   * previously hard-coded constant everywhere it was used.
   */
  async windowDaysFor(studioId: string): Promise<number> {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { attributionWindowDays: true } });
    return studio?.attributionWindowDays ?? DEFAULT_ATTRIBUTION_WINDOW_DAYS;
  }

  /** Attaches a visitor's touchpoints to a contact. Never throws. */
  async identify(studioId: string, visitorId: string | null | undefined, contactId: string, at = new Date()): Promise<void> {
    if (!visitorId) return;
    try {
      const visitor = await this.prisma.visitor.findUnique({ where: { studioId_id: { studioId, id: visitorId } } });
      // Without a stored visitor (no consent, or first request never tracked) there is nothing to attach.
      if (!visitor) return;
      await this.prisma.$transaction([
        this.prisma.visitor.update({
          where: { studioId_id: { studioId, id: visitorId } },
          data: { contactId, lastSeenAt: at },
        }),
        this.prisma.touchpoint.updateMany({
          where: { studioId, visitorId, contactId: null },
          data: { contactId },
        }),
      ]);
      await this.refreshContactTouches(studioId, contactId, at);
    } catch (err) {
      this.logger.warn(`Visitor identification failed for contact ${contactId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Recomputes the first/last touch summary: first = earliest touchpoint of
   * the contact, last = most recent touchpoint within the attribution window
   * before `at`. Without a touch in the window the last-touch columns keep
   * their previous value.
   */
  async refreshContactTouches(studioId: string, contactId: string, at = new Date()): Promise<void> {
    const touches = await this.prisma.touchpoint.findMany({
      where: { studioId, contactId, occurredAt: { lte: at } },
      orderBy: { occurredAt: 'asc' },
    });
    if (touches.length === 0) return;
    const windowDays = await this.windowDaysFor(studioId);
    const first = pickFirstTouch(touches, at);
    const last = pickLastTouch(touches, at, windowDays);
    const data: Prisma.ContactUncheckedUpdateManyInput = {
      ...(first ? { firstTouchpointId: first.id, ...summaryColumns('first', touchSummary(first)) } : {}),
      ...(last ? { lastTouchpointId: last.id, ...summaryColumns('last', touchSummary(last)) } : {}),
    };
    await this.prisma.contact.updateMany({ where: { id: contactId, studioId }, data });
  }

  /** Last touchpoint of the contact before `at` within the attribution window. */
  async lastTouchFor(studioId: string, contactId: string, at: Date): Promise<Touchpoint | null> {
    const windowDays = await this.windowDaysFor(studioId);
    return this.prisma.touchpoint.findFirst({
      where: {
        studioId,
        contactId,
        occurredAt: { lte: at, gte: new Date(at.getTime() - windowDays * DAY_MS) },
      },
      orderBy: { occurredAt: 'desc' },
    });
  }

  /**
   * Conversions per report key and revenue per currency for events in
   * [from, to), under the chosen model. Test contacts and test events are
   * excluded. LINEAR splits one conversion across its touches, so counts
   * can be fractional.
   */
  async report(studioId: string, query: AttributionReportQuery): Promise<AttributionReportDTO> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const windowDays = await this.windowDaysFor(studioId);

    const events = await this.prisma.conversionEvent.findMany({
      where: { studioId, isTest: false, occurredAt: { gte: from, lt: to }, contact: { isTest: false } },
      include: { contact: true },
      orderBy: { occurredAt: 'asc' },
    });
    const contactIds = [...new Set(events.map((e) => e.contactId))];
    const touches = contactIds.length
      ? await this.prisma.touchpoint.findMany({
          where: { studioId, contactId: { in: contactIds }, occurredAt: { lte: to } },
          orderBy: { occurredAt: 'asc' },
        })
      : [];
    const touchesByContact = new Map<string, Touchpoint[]>();
    for (const t of touches) {
      if (!t.contactId) continue;
      const list = touchesByContact.get(t.contactId) ?? [];
      list.push(t);
      touchesByContact.set(t.contactId, list);
    }

    const rows = new Map<string, { conversions: Map<ConversionEventType, number>; revenue: Map<string, Prisma.Decimal> }>();
    const totals = { conversions: new Map<ConversionEventType, number>(), revenue: new Map<string, Prisma.Decimal>() };

    for (const event of events) {
      const type = event.type as ConversionEventType;
      const credits = creditConversion(
        query.model,
        {
          touches: touchesByContact.get(event.contactId) ?? [],
          at: event.occurredAt,
          windowDays,
          firstSummary: contactSummary(event.contact, 'first'),
          lastSummary: contactSummary(event.contact, 'last'),
        },
        query.groupBy,
      );
      addTo(totals.conversions, type, 1);
      if (event.valueAmount && event.currency) addMoney(totals.revenue, event.currency, event.valueAmount);
      for (const credit of credits) {
        const row = rows.get(credit.key) ?? { conversions: new Map(), revenue: new Map() };
        addTo(row.conversions, type, credit.weight);
        if (event.valueAmount && event.currency) {
          addMoney(row.revenue, event.currency, event.valueAmount.mul(credit.weight));
        }
        rows.set(credit.key, row);
      }
    }

    const untaggedPaidTouchpoints = await this.prisma.touchpoint.count({
      where: { studioId, isPaidUntagged: true, occurredAt: { gte: from, lt: to } },
    });

    // G2b: match ad spend to each report key (see SPEND_LEVEL_BY_GROUP_BY).
    const spendLevel = SPEND_LEVEL_BY_GROUP_BY[query.groupBy];
    const spendDailyRows = await this.prisma.adSpendDaily.findMany({
      where: { studioId, level: spendLevel, date: { gte: from, lt: to } },
    });
    const spendByKey = new Map<string, Map<string, Prisma.Decimal>>();
    for (const spendRow of spendDailyRows) {
      const key = query.groupBy === 'source' ? spendRow.platform.toLowerCase() : spendRow.externalId;
      const byCurrency = spendByKey.get(key) ?? new Map<string, Prisma.Decimal>();
      byCurrency.set(spendRow.currency, (byCurrency.get(spendRow.currency) ?? new Prisma.Decimal(0)).add(spendRow.spendAmount));
      spendByKey.set(key, byCurrency);
    }
    const totalSpend = new Map<string, Prisma.Decimal>();
    for (const byCurrency of spendByKey.values()) {
      for (const [currency, amount] of byCurrency) addMoney(totalSpend, currency, amount);
    }

    const rowDtos: AttributionReportRowDTO[] = [...rows.entries()]
      .map(([key, row]) => toRowDto(key, row, spendByKey.get(key) ?? new Map()))
      .sort((a, b) => sumCounts(b.conversions) - sumCounts(a.conversions) || a.key.localeCompare(b.key));

    return {
      model: query.model,
      groupBy: query.groupBy,
      from: from.toISOString(),
      to: to.toISOString(),
      windowDays,
      rows: rowDtos,
      totals: toTotalsDto(totals, totalSpend),
      untaggedPaidTouchpoints,
    };
  }
}

type SummaryPrefix = 'first' | 'last';

export function summaryColumns(prefix: SummaryPrefix, s: TouchSummary) {
  const cap = (v: string | null) => (v === null ? null : v.slice(0, 250));
  return prefix === 'first'
    ? {
        firstSource: cap(s.source),
        firstMedium: cap(s.medium),
        firstCampaignName: cap(s.campaignName),
        firstCampaignId: cap(s.campaignId),
        firstAdsetId: cap(s.adsetId),
        firstAdId: cap(s.adId),
      }
    : {
        lastSource: cap(s.source),
        lastMedium: cap(s.medium),
        lastCampaignName: cap(s.campaignName),
        lastCampaignId: cap(s.campaignId),
        lastAdsetId: cap(s.adsetId),
        lastAdId: cap(s.adId),
      };
}

interface ContactSummaryColumns {
  firstSource: string | null;
  firstMedium: string | null;
  firstCampaignName: string | null;
  firstCampaignId: string | null;
  firstAdsetId: string | null;
  firstAdId: string | null;
  lastSource: string | null;
  lastMedium: string | null;
  lastCampaignName: string | null;
  lastCampaignId: string | null;
  lastAdsetId: string | null;
  lastAdId: string | null;
}

function contactSummary(c: ContactSummaryColumns, prefix: SummaryPrefix): TouchSummary {
  return prefix === 'first'
    ? {
        source: c.firstSource,
        medium: c.firstMedium,
        campaignName: c.firstCampaignName,
        campaignId: c.firstCampaignId,
        adsetId: c.firstAdsetId,
        adId: c.firstAdId,
      }
    : {
        source: c.lastSource,
        medium: c.lastMedium,
        campaignName: c.lastCampaignName,
        campaignId: c.lastCampaignId,
        adsetId: c.lastAdsetId,
        adId: c.lastAdId,
      };
}

function addTo<K>(map: Map<K, number>, key: K, n: number) {
  map.set(key, (map.get(key) ?? 0) + n);
}

function addMoney(map: Map<string, Prisma.Decimal>, currency: string, amount: Prisma.Decimal) {
  map.set(currency, (map.get(currency) ?? new Prisma.Decimal(0)).add(amount));
}

function countsDto(map: Map<ConversionEventType, number>): Partial<Record<ConversionEventType, number>> {
  const out: Partial<Record<ConversionEventType, number>> = {};
  for (const [k, v] of map) out[k] = Math.round(v * 10_000) / 10_000;
  return out;
}

function moneyDto(map: Map<string, Prisma.Decimal>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of map) out[k] = v.toFixed(2);
  return out;
}

function sumCounts(c: Partial<Record<ConversionEventType, number>>): number {
  return Object.values(c).reduce<number>((a, b) => a + (b ?? 0), 0);
}

/** Per-currency cpl/cac/roas, using the currency the spend is in (revenue/lead/acquisition counts are read for that same currency). */
function ratiosFor(
  conversions: Map<ConversionEventType, number>,
  revenue: Map<string, Prisma.Decimal>,
  spend: Map<string, Prisma.Decimal>,
): { cpl: Record<string, number | null>; cac: Record<string, number | null>; roas: Record<string, number | null> } {
  const leads = conversions.get('lead') ?? 0;
  let acquired = 0;
  for (const type of CAC_ACQUISITION_EVENT_TYPES) acquired += conversions.get(type) ?? 0;

  const cpl: Record<string, number | null> = {};
  const cac: Record<string, number | null> = {};
  const roas: Record<string, number | null> = {};
  for (const [currency, amount] of spend) {
    const spendNumber = Number(amount.toFixed(4));
    cpl[currency] = computeCpl(spendNumber, leads);
    cac[currency] = computeCac(spendNumber, acquired);
    const revenueForCurrency = revenue.get(currency);
    roas[currency] = revenueForCurrency ? computeRoas(Number(revenueForCurrency.toFixed(4)), spendNumber) : null;
  }
  return { cpl, cac, roas };
}

function toRowDto(
  key: string,
  row: { conversions: Map<ConversionEventType, number>; revenue: Map<string, Prisma.Decimal> },
  spend: Map<string, Prisma.Decimal>,
): AttributionReportRowDTO {
  const ratios = ratiosFor(row.conversions, row.revenue, spend);
  return { key, conversions: countsDto(row.conversions), revenue: moneyDto(row.revenue), spend: moneyDto(spend), ...ratios };
}

function toTotalsDto(
  totals: { conversions: Map<ConversionEventType, number>; revenue: Map<string, Prisma.Decimal> },
  spend: Map<string, Prisma.Decimal>,
): AttributionReportDTO['totals'] {
  const ratios = ratiosFor(totals.conversions, totals.revenue, spend);
  return { conversions: countsDto(totals.conversions), revenue: moneyDto(totals.revenue), spend: moneyDto(spend), ...ratios };
}
