import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { MarketingInsight } from '@platform/database';
import {
  INSIGHT_ACTIONS_MAX,
  InsightActionSchema,
  InsightKpisSchema,
  MARKETING_GUARD_TEMPLATE_KEYS,
  buildInsightKpis,
  insightHasSignal,
  insightMetricKeys,
  insightMetricLine,
  insightWeekFor,
  isoDateKey,
  isoWeekStart,
} from '@platform/shared';
import type { InsightAction, InsightKpis, InsightWeek, MarketingInsightDTO } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import { AiError } from '../../ai/ai-errors';
import { AiProviderError } from '../../ai/providers/ai-provider';
import { MARKETING_WEEKLY_SUMMARY_SYSTEM_PROMPT, parseWeeklySummaryOutput, weeklySummaryUserMessage } from '../../ai/marketing-prompts';
import { MarketingDashboardService } from '../dashboard/marketing-dashboard.service';
import { MarketingNoticeService } from '../../growth/campaigns/approval/marketing-notice.service';
import { MarketingSettingsService } from '../../growth/campaigns/approval/marketing-settings.service';

/** A week is tried at most this many times by the heartbeat (each try that reaches the model is metered). */
const MAX_HEARTBEAT_ATTEMPTS_PER_WEEK = 3;
const DEFAULT_SUMMARY_LOCALE = 'tr';

export interface WeeklyRunResult {
  /** True when this run stored a new insight. */
  generated: boolean;
  /** Why nothing was generated. */
  skipped: 'DISABLED' | 'EXISTS' | 'NO_PLATFORM' | 'AI_UNAVAILABLE' | 'TOO_MANY_ATTEMPTS' | null;
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof AiProviderError) return new AiError(err.code);
  throw err;
}

function parseKpis(raw: Prisma.JsonValue): InsightKpis {
  return InsightKpisSchema.parse(raw);
}

function parseActions(raw: Prisma.JsonValue): InsightAction[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.flatMap((item) => {
    const parsed = InsightActionSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function toInsightDto(row: MarketingInsight): MarketingInsightDTO {
  return {
    id: row.id,
    periodStart: isoDateKey(row.periodStart),
    periodEnd: isoDateKey(row.periodEnd),
    kpis: parseKpis(row.kpis),
    summary: row.summary,
    actions: parseActions(row.actions),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The weekly marketing summary (M3d, docs/PAZARLAMA_MODULU.md 3.3, 7.4). Once
 * per ISO week the heartbeat takes the dashboard numbers of the last complete
 * week and of the week before (aggregate KPIs, k-anonymous, no person data),
 * asks the AI core for a short summary and 3-5 actions grounded in those
 * numbers only (MARKETING_WEEKLY_SUMMARY, counted against the marketing AI
 * budget), stores it in `marketing_insights` (unique per studio and week, so
 * a second run never duplicates) and e-mails the configured recipients. The
 * summary is written once, in the platform's default locale; the e-mail
 * formats the numbers per recipient locale.
 */
@Injectable()
export class MarketingInsightsService {
  private readonly logger = new Logger(MarketingInsightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: MarketingDashboardService,
    private readonly ai: AiService,
    private readonly settings: MarketingSettingsService,
    private readonly notices: MarketingNoticeService,
  ) {}

  async list(studioId: string, limit: number): Promise<MarketingInsightDTO[]> {
    const rows = await this.prisma.marketingInsight.findMany({ where: { studioId }, orderBy: { periodStart: 'desc' }, take: limit });
    return rows.map(toInsightDto);
  }

  /** Heartbeat: generates the insight of the last complete week when the setting is on and the week has none yet. */
  async runWeekly(now: Date): Promise<WeeklyRunResult> {
    const studio = await this.prisma.studio.findFirst({ where: { isPlatform: true }, select: { id: true } });
    if (!studio) return { generated: false, skipped: 'NO_PLATFORM' };
    const config = await this.settings.get(studio.id);
    if (!config.weeklySummaryEnabled) return { generated: false, skipped: 'DISABLED' };

    const week = insightWeekFor(now);
    const exists = await this.prisma.marketingInsight.findUnique({
      where: { studioId_periodStart: { studioId: studio.id, periodStart: week.periodStart } },
      select: { id: true },
    });
    if (exists) return { generated: false, skipped: 'EXISTS' };

    const attempts = await this.prisma.aiUsage.count({ where: { studioId: studio.id, task: 'MARKETING_WEEKLY_SUMMARY', createdAt: { gte: isoWeekStart(now) } } });
    if (attempts >= MAX_HEARTBEAT_ATTEMPTS_PER_WEEK) return { generated: false, skipped: 'TOO_MANY_ATTEMPTS' };

    try {
      const result = await this.generate(studio.id, week, { now, force: false, notify: true, actorUserId: null });
      return { generated: result.created, skipped: result.created ? null : 'EXISTS' };
    } catch (err) {
      if (err instanceof AiError) {
        // Not configured, budget or cap reached, provider down: the next heartbeat tries again (bounded above).
        this.logger.warn(`Weekly marketing summary not generated: ${err.code}`);
        return { generated: false, skipped: 'AI_UNAVAILABLE' };
      }
      throw err;
    }
  }

  /**
   * Builds and stores the insight of `week`. Without `force` an existing
   * insight is returned untouched (`created: false`); with it the week is
   * regenerated in place. AI failures throw an AiError.
   */
  async generate(
    studioId: string,
    week: InsightWeek,
    options: { now: Date; force: boolean; notify: boolean; actorUserId: string | null },
  ): Promise<{ created: boolean; insight: MarketingInsightDTO }> {
    const key = { studioId_periodStart: { studioId, periodStart: week.periodStart } };
    const existing = await this.prisma.marketingInsight.findUnique({ where: key });
    if (existing && !options.force) return { created: false, insight: toInsightDto(existing) };

    const [current, previous] = await Promise.all([this.dashboard.blockFor(studioId, week.current), this.dashboard.blockFor(studioId, week.previous)]);
    const kpis = buildInsightKpis(
      current,
      previous,
      { from: isoDateKey(week.current.from), to: isoDateKey(week.current.to) },
      { from: isoDateKey(week.previous.from), to: isoDateKey(week.previous.to) },
    );

    const locale = await this.summaryLocale(studioId);
    let summary: string;
    let actions: InsightAction[] = [];
    let aiUsageId: string | null = null;
    if (insightHasSignal(kpis)) {
      try {
        const result = await this.ai.run(
          {
            task: 'MARKETING_WEEKLY_SUMMARY',
            studioId,
            userId: options.actorUserId,
            system: [MARKETING_WEEKLY_SUMMARY_SYSTEM_PROMPT],
            messages: [{ role: 'user', content: weeklySummaryUserMessage({ locale, kpis }) }],
            maxTokens: 1_500,
            timeoutMs: 60_000,
          },
          options.now,
        );
        aiUsageId = result.usageId;
        const parsed = parseWeeklySummaryOutput(result.text, insightMetricKeys(kpis));
        summary = parsed.summary;
        actions = parsed.actions.slice(0, INSIGHT_ACTIONS_MAX);
      } catch (err) {
        throw toAiError(err);
      }
    } else {
      // Nothing visible to talk about (a quiet week, or every count below the minimum): no model call.
      summary = this.notices.translator(locale).t('marketingInsights.noData');
    }

    const data = {
      periodEnd: week.periodEnd,
      kpis: kpis as unknown as Prisma.InputJsonValue,
      summary,
      actions: actions as unknown as Prisma.InputJsonValue,
      aiUsageId,
    };
    let row: MarketingInsight;
    try {
      row = options.force
        ? await this.prisma.marketingInsight.upsert({ where: key, create: { studioId, periodStart: week.periodStart, ...data }, update: { ...data, createdAt: new Date() } })
        : await this.prisma.marketingInsight.create({ data: { studioId, periodStart: week.periodStart, ...data } });
    } catch (err) {
      // A second worker stored the same week first: the unique key keeps it once.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const stored = await this.prisma.marketingInsight.findUniqueOrThrow({ where: key });
        return { created: false, insight: toInsightDto(stored) };
      }
      throw err;
    }

    await this.prisma.auditLog.create({
      data: {
        studioId,
        userId: options.actorUserId,
        action: 'marketing.insight.generated',
        entityType: 'MarketingInsight',
        entityId: row.id,
        metadata: { periodStart: isoDateKey(row.periodStart), forced: options.force, notified: options.notify, aiUsageId } as Prisma.InputJsonValue,
      },
    });

    const insight = toInsightDto(row);
    if (options.notify) await this.email(studioId, insight);
    return { created: true, insight };
  }

  /** The language the summary is written in: the brand kit's default locale of the platform tenant, else Turkish. */
  private async summaryLocale(studioId: string): Promise<string> {
    const kit = await this.prisma.brandKit.findUnique({ where: { studioId }, select: { defaultLocale: true } });
    return kit?.defaultLocale ?? DEFAULT_SUMMARY_LOCALE;
  }

  /** E-mails the summary to the configured platform users, numbers formatted in each recipient's locale. */
  private async email(studioId: string, insight: MarketingInsightDTO): Promise<void> {
    const config = await this.settings.get(studioId);
    if (config.weeklySummaryRecipients.length === 0) return;
    const allowed = new Set((await this.settings.recipients()).map((r) => r.userId));
    const users = await this.prisma.user.findMany({
      where: { id: { in: config.weeklySummaryRecipients.filter((id) => allowed.has(id)) }, isActive: true },
      select: { id: true, locale: true },
      orderBy: { id: 'asc' },
    });
    for (const user of users) {
      const { t, locale } = this.notices.translator(user.locale);
      const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
      const lines = insight.kpis.metrics.flatMap((m) => {
        const line = insightMetricLine(m, t, locale, insight.kpis.minCell);
        return line ? [`- ${line}`] : [];
      });
      await this.notices.deliver(
        studioId,
        user.id,
        MARKETING_GUARD_TEMPLATE_KEYS.weeklySummary,
        {
          period: `${day.format(new Date(`${insight.periodStart}T00:00:00.000Z`))} - ${day.format(new Date(`${insight.periodEnd}T00:00:00.000Z`))}`,
          summary: insight.summary,
          metrics: lines.length > 0 ? lines.join('\n') : '-',
          actions: insight.actions.length > 0 ? insight.actions.map((a, i) => `${i + 1}. ${a.title}: ${a.detail}`).join('\n') : '-',
          link: this.notices.link(),
        },
        ['EMAIL'],
      );
    }
  }
}
