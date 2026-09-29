import { Injectable } from '@nestjs/common';
import type { Campaign } from '@platform/database';
import {
  BEST_TIME_LOOKBACK_DAYS,
  BEST_TIME_MIN_RECIPIENT_INTERACTIONS,
  HISTOGRAM_HOURS,
  bestHourOf,
  buildHourHistogram,
  countryOfPhone,
  emptyHourHistogram,
  parseMessagingSettings,
  planRecipientSend,
  resolveBestHour,
  resolveRecipientTimeZone,
} from '@platform/shared';
import type { BestHourResolution, CampaignSendTimeMode, HourHistogram } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const CHUNK = 1000;

type CampaignTiming = Pick<Campaign, 'id' | 'studioId' | 'sendTimeMode' | 'sendTimeLocal'>;

/** Everything one planning run needs from the tenant; loaded once per run. */
export interface SendTimeContext {
  studioId: string;
  mode: CampaignSendTimeMode;
  sendTimeLocal: string | null;
  defaultLocal: string;
  studioTimezone: string | null;
  startAt: Date;
  /** Tenant-wide histogram, built on first use (BEST_TIME only). */
  studioHistogram: HourHistogram | null;
}

/**
 * Plans when each campaign recipient's message is due (M3c): the recipient's
 * own clock for RECIPIENT_LOCAL, their engagement history for BEST_TIME (own
 * history, then the tenant's, then the campaign's fallback time). It only
 * decides a due instant per contact; the messaging engine still checks quiet
 * hours, consent and the frequency cap when the message actually goes out,
 * and the plan never lands inside the commercial send window's closed hours.
 */
@Injectable()
export class CampaignSendTimeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Null for FIXED campaigns: nothing to plan. */
  async context(campaign: CampaignTiming, startAt: Date): Promise<SendTimeContext | null> {
    if (campaign.sendTimeMode === 'FIXED') return null;
    const studio = await this.prisma.studio.findUnique({ where: { id: campaign.studioId }, select: { timezone: true, messagingSettings: true } });
    return {
      studioId: campaign.studioId,
      mode: campaign.sendTimeMode,
      sendTimeLocal: campaign.sendTimeLocal,
      defaultLocal: parseMessagingSettings(studio?.messagingSettings).defaultSendTimeLocal,
      studioTimezone: studio?.timezone ?? null,
      startAt,
      studioHistogram: null,
    };
  }

  /** The due instant of every contact (a map for the given ids; every id gets an entry). */
  async plan(ctx: SendTimeContext, contactIds: readonly string[]): Promise<Map<string, Date>> {
    const due = new Map<string, Date>();
    for (let i = 0; i < contactIds.length; i += CHUNK) {
      const ids = contactIds.slice(i, i + CHUNK);
      const contacts = await this.prisma.contact.findMany({
        where: { id: { in: [...ids] }, studioId: ctx.studioId },
        select: { id: true, timezone: true, countryCode: true, phone: true, membership: { select: { user: { select: { phone: true } } } } },
      });
      const history = ctx.mode === 'BEST_TIME' ? await this.recipientEvents(ctx, ids) : new Map<string, Date[]>();
      for (const contact of contacts) {
        const country = contact.countryCode ?? countryOfPhone(contact.phone ?? contact.membership?.user.phone ?? null);
        const timeZone = resolveRecipientTimeZone({ timezone: contact.timezone, countryCode: country, studioTimezone: ctx.studioTimezone });
        let best: BestHourResolution | null = null;
        if (ctx.mode === 'BEST_TIME') {
          const own = buildHourHistogram(history.get(contact.id) ?? [], timeZone);
          // The tenant histogram is only needed (and loaded) when a contact's own history is too thin.
          const studio = bestHourOf(own, BEST_TIME_MIN_RECIPIENT_INTERACTIONS) === null ? await this.studioHistogram(ctx) : null;
          best = resolveBestHour({ recipient: own, studio });
        }
        due.set(contact.id, planRecipientSend({ mode: ctx.mode, startAt: ctx.startAt, timeZone, sendTimeLocal: ctx.sendTimeLocal, defaultLocal: ctx.defaultLocal, best }).at);
      }
      // A contact that vanished between the snapshot and now still needs a due time.
      for (const id of ids) {
        if (!due.has(id)) {
          due.set(id, planRecipientSend({ mode: ctx.mode, startAt: ctx.startAt, timeZone: resolveRecipientTimeZone({ studioTimezone: ctx.studioTimezone }), sendTimeLocal: ctx.sendTimeLocal, defaultLocal: ctx.defaultLocal, best: null }).at);
        }
      }
    }
    return due;
  }

  /** Human (non-machine) opens and clicks of these contacts in the look-back window. */
  private async recipientEvents(ctx: SendTimeContext, contactIds: readonly string[]): Promise<Map<string, Date[]>> {
    const since = new Date(ctx.startAt.getTime() - BEST_TIME_LOOKBACK_DAYS * DAY_MS);
    const rows = await this.prisma.messageTrackingEvent.findMany({
      where: {
        studioId: ctx.studioId,
        type: { in: ['OPEN', 'CLICK'] },
        isMachine: false,
        occurredAt: { gte: since, lte: ctx.startAt },
        notificationLog: { contactId: { in: [...contactIds] } },
      },
      select: { occurredAt: true, notificationLog: { select: { contactId: true } } },
    });
    const byContact = new Map<string, Date[]>();
    for (const row of rows) {
      const id = row.notificationLog.contactId;
      if (!id) continue;
      const list = byContact.get(id);
      if (list) list.push(row.occurredAt);
      else byContact.set(id, [row.occurredAt]);
    }
    return byContact;
  }

  /**
   * The tenant-wide histogram of the look-back window, read on each opening
   * contact's own clock (their time zone, else the tenant's), cached on the context.
   */
  private async studioHistogram(ctx: SendTimeContext): Promise<HourHistogram> {
    if (ctx.studioHistogram) return ctx.studioHistogram;
    const since = new Date(ctx.startAt.getTime() - BEST_TIME_LOOKBACK_DAYS * DAY_MS);
    const zone = resolveRecipientTimeZone({ studioTimezone: ctx.studioTimezone });
    const rows = await this.prisma.$queryRaw<{ hour: number; n: number }[]>`
      SELECT extract(hour FROM ((e."occurred_at" AT TIME ZONE 'UTC') AT TIME ZONE
               CASE WHEN c."timezone" IN (SELECT "name" FROM pg_timezone_names) THEN c."timezone" ELSE ${zone} END))::int AS hour,
             count(*)::int AS n
      FROM "message_tracking_events" e
      JOIN "notification_logs" l ON l."id" = e."notification_log_id"
      LEFT JOIN "contacts" c ON c."id" = l."contact_id"
      WHERE e."studio_id" = ${ctx.studioId}::uuid
        AND e."type" IN ('OPEN', 'CLICK')
        AND e."is_machine" = false
        AND e."occurred_at" >= ${since}
        AND e."occurred_at" <= ${ctx.startAt}
      GROUP BY 1`;
    const histogram = emptyHourHistogram();
    for (const row of rows) {
      if (row.hour >= 0 && row.hour < HISTOGRAM_HOURS) histogram[row.hour] = row.n;
    }
    ctx.studioHistogram = histogram;
    return histogram;
  }
}
