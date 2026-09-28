import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Touchpoint } from '@platform/database';
import { DEFAULT_ATTRIBUTION_WINDOW_DAYS } from '@platform/shared';
import type {
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
 * Visitor identification and attribution (docs/CRM_VE_ATIF.md).
 * identify() runs server side when a form, booking or sign-up creates or
 * finds a Contact and the request carries the pw_vid visitor id: the
 * visitor's touchpoints are attached to the contact and its first/last
 * touch summary is refreshed.
 */
@Injectable()
export class AttributionService {
  private readonly logger = new Logger(AttributionService.name);
  readonly windowDays = DEFAULT_ATTRIBUTION_WINDOW_DAYS;

  constructor(private readonly prisma: PrismaService) {}

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
    const first = pickFirstTouch(touches, at);
    const last = pickLastTouch(touches, at, this.windowDays);
    const data: Prisma.ContactUncheckedUpdateManyInput = {
      ...(first ? { firstTouchpointId: first.id, ...summaryColumns('first', touchSummary(first)) } : {}),
      ...(last ? { lastTouchpointId: last.id, ...summaryColumns('last', touchSummary(last)) } : {}),
    };
    await this.prisma.contact.updateMany({ where: { id: contactId, studioId }, data });
  }

  /** Last touchpoint of the contact before `at` within the attribution window. */
  async lastTouchFor(studioId: string, contactId: string, at: Date): Promise<Touchpoint | null> {
    return this.prisma.touchpoint.findFirst({
      where: {
        studioId,
        contactId,
        occurredAt: { lte: at, gte: new Date(at.getTime() - this.windowDays * DAY_MS) },
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
          windowDays: this.windowDays,
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

    const rowDtos: AttributionReportRowDTO[] = [...rows.entries()]
      .map(([key, row]) => ({ key, conversions: countsDto(row.conversions), revenue: moneyDto(row.revenue) }))
      .sort((a, b) => sumCounts(b.conversions) - sumCounts(a.conversions) || a.key.localeCompare(b.key));

    return {
      model: query.model,
      groupBy: query.groupBy,
      from: from.toISOString(),
      to: to.toISOString(),
      windowDays: this.windowDays,
      rows: rowDtos,
      totals: { conversions: countsDto(totals.conversions), revenue: moneyDto(totals.revenue) },
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
