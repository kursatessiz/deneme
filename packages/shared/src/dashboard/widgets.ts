import { z } from 'zod';
import type { PermissionKey } from '../permissions';
import type { MessageKey } from '../i18n';

/**
 * Card catalogue of the overview page (docs/WEB_PANEL.md, "Genel bakış
 * kartları"). Every card the "Kart ekle" dialog offers, the permissions it
 * needs (all of them; the owner always has every permission), its size
 * limits in grid units and its small per-card settings. The API checks the
 * same permissions when it computes a card's data, so a card the caller may
 * not see is never filled even when a stale layout still lists it.
 */

export const DASHBOARD_WIDGET_CATEGORIES = ['metrics', 'charts', 'tables', 'calendar', 'operations'] as const;
export type DashboardWidgetCategory = (typeof DASHBOARD_WIDGET_CATEGORIES)[number];

/** Time windows a card can summarise; the API resolves them in the studio's time zone. */
export const DASHBOARD_PERIODS = ['today', 'week', 'month', 'last30'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];
export const DashboardPeriodSchema = z.enum(DASHBOARD_PERIODS);

/** Settings a card may store next to its position. Unknown fields are rejected. */
export const DashboardWidgetSettingsSchema = z
  .object({
    period: DashboardPeriodSchema.optional(),
  })
  .strict();
export type DashboardWidgetSettings = z.infer<typeof DashboardWidgetSettingsSchema>;

export const DASHBOARD_WIDGET_KEYS = [
  'revenue',
  'activeMembers',
  'newMembers',
  'memberGrowth',
  'occupancy',
  'todaySessions',
  'renewalRate',
  'churnRisk',
  'newLeads',
  'revenueTrend',
  'occupancyTrend',
  'memberGrowthChart',
  'todaySchedule',
  'upcomingSessions',
  'recentPayments',
  'expiringPackages',
  'trainerPerformance',
  'weekCalendar',
  'branches',
  'lowStock',
  'upcomingEvents',
  'quickActions',
] as const;
export type DashboardWidgetKey = (typeof DASHBOARD_WIDGET_KEYS)[number];

export function isDashboardWidgetKey(value: unknown): value is DashboardWidgetKey {
  return typeof value === 'string' && (DASHBOARD_WIDGET_KEYS as readonly string[]).includes(value);
}

export const DashboardWidgetKeySchema = z.string().refine(isDashboardWidgetKey, { message: 'Bilinmeyen kart' }) as unknown as z.ZodType<DashboardWidgetKey>;

/** Size limits and the size a new card gets, in grid units (columns of the 12 column grid, rows). */
export interface DashboardWidgetSize {
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  defaultW: number;
  defaultH: number;
}

/**
 * The size rule (docs/TASARIM.md, "Genel bakış kartlarının boyut kuralı"):
 * the minimum is the smallest box in which the card's content still reads
 * without truncating its key figure (a KPI value and its comparison line, a
 * chart with axis labels, a table with its primary column and figure, seven
 * calendar day columns); the maximum is where the content would only gain
 * empty space.
 */
export const DASHBOARD_SIZE_PRESETS = {
  kpi: { minW: 2, minH: 2, maxW: 4, maxH: 3, defaultW: 3, defaultH: 2 },
  chart: { minW: 4, minH: 3, maxW: 12, maxH: 6, defaultW: 6, defaultH: 4 },
  table: { minW: 4, minH: 4, maxW: 12, maxH: 8, defaultW: 6, defaultH: 5 },
  calendar: { minW: 6, minH: 4, maxW: 12, maxH: 8, defaultW: 8, defaultH: 5 },
  list: { minW: 3, minH: 3, maxW: 8, maxH: 6, defaultW: 4, defaultH: 4 },
  actions: { minW: 4, minH: 2, maxW: 12, maxH: 3, defaultW: 12, defaultH: 2 },
} as const satisfies Record<string, DashboardWidgetSize>;

/** A card's period setting: which periods it offers and the one a new card starts with. */
export interface DashboardPeriodSetting {
  periods: readonly DashboardPeriod[];
  defaultPeriod: DashboardPeriod;
  /** Validates a stored settings object for this card. */
  schema: z.ZodType<DashboardWidgetSettings>;
}

function periodSetting(periods: readonly DashboardPeriod[], defaultPeriod: DashboardPeriod): DashboardPeriodSetting {
  const schema = DashboardWidgetSettingsSchema.refine((s) => s.period === undefined || periods.includes(s.period), {
    message: 'Bu kart için geçersiz dönem',
    path: ['period'],
  });
  return { periods, defaultPeriod, schema };
}

const ALL_PERIODS = periodSetting(DASHBOARD_PERIODS, 'month');
const RANGE_PERIODS = (fallback: DashboardPeriod) => periodSetting(['week', 'month', 'last30'], fallback);

export interface DashboardWidgetDefinition {
  key: DashboardWidgetKey;
  category: DashboardWidgetCategory;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  /** Every one of these is needed; empty means any membership of the studio. */
  requiredPermissions: readonly PermissionKey[];
  size: DashboardWidgetSize;
  /** At most one card of this kind per board. */
  singleton: boolean;
  /** Present when the card stores a period (its settings schema and allowed values). */
  settings?: DashboardPeriodSetting;
  /** Rendered from the session alone; the data endpoint has nothing to compute for it. */
  clientOnly?: boolean;
}

function def(
  key: DashboardWidgetKey,
  category: DashboardWidgetCategory,
  size: DashboardWidgetSize,
  requiredPermissions: readonly PermissionKey[],
  options: { singleton?: boolean; settings?: DashboardPeriodSetting; clientOnly?: boolean } = {},
): DashboardWidgetDefinition {
  return {
    key,
    category,
    titleKey: `dashboard.widget.${key}.title` as MessageKey,
    descriptionKey: `dashboard.widget.${key}.description` as MessageKey,
    requiredPermissions,
    size,
    // A card with a period can be added more than once (one per period); the rest are singletons.
    singleton: options.singleton ?? options.settings === undefined,
    settings: options.settings,
    clientOnly: options.clientOnly,
  };
}

const P = DASHBOARD_SIZE_PRESETS;

export const DASHBOARD_WIDGETS: readonly DashboardWidgetDefinition[] = [
  def('revenue', 'metrics', P.kpi, ['reports.view'], { settings: ALL_PERIODS }),
  def('activeMembers', 'metrics', P.kpi, ['reports.view']),
  def('newMembers', 'metrics', P.kpi, ['reports.view'], { settings: ALL_PERIODS }),
  def('memberGrowth', 'metrics', P.kpi, ['reports.view'], { settings: RANGE_PERIODS('month') }),
  def('occupancy', 'metrics', P.kpi, ['reports.view'], { settings: periodSetting(DASHBOARD_PERIODS, 'week') }),
  def('todaySessions', 'metrics', P.kpi, ['schedule.view']),
  def('renewalRate', 'metrics', P.kpi, ['reports.view'], { settings: periodSetting(['month', 'last30'], 'last30') }),
  def('churnRisk', 'metrics', P.kpi, ['reports.view']),
  def('newLeads', 'metrics', P.kpi, ['leads.view'], { settings: periodSetting(DASHBOARD_PERIODS, 'week') }),
  def('revenueTrend', 'charts', P.chart, ['reports.view'], { settings: RANGE_PERIODS('last30') }),
  def('occupancyTrend', 'charts', P.chart, ['reports.view'], { settings: RANGE_PERIODS('last30') }),
  def('memberGrowthChart', 'charts', P.chart, ['reports.view']),
  def('todaySchedule', 'tables', P.table, ['schedule.view']),
  def('upcomingSessions', 'tables', P.table, ['schedule.view']),
  def('recentPayments', 'tables', P.table, ['finance.view']),
  def('expiringPackages', 'tables', P.table, ['members.view']),
  def('trainerPerformance', 'tables', P.table, ['reports.view'], { settings: RANGE_PERIODS('month') }),
  def('weekCalendar', 'calendar', P.calendar, ['schedule.view']),
  def('branches', 'operations', P.list, []),
  def('lowStock', 'operations', P.list, ['retail.view']),
  def('upcomingEvents', 'operations', P.list, ['events.view']),
  def('quickActions', 'operations', P.actions, [], { clientOnly: true }),
];

const BY_KEY = new Map<DashboardWidgetKey, DashboardWidgetDefinition>(DASHBOARD_WIDGETS.map((w) => [w.key, w]));

export function getDashboardWidget(key: DashboardWidgetKey): DashboardWidgetDefinition {
  const found = BY_KEY.get(key);
  if (!found) throw new Error(`Unknown dashboard widget: ${key}`);
  return found;
}

/** True when the membership may see this card: the owner always, others with every required permission. */
export function canViewDashboardWidget(
  widget: DashboardWidgetDefinition | DashboardWidgetKey,
  permissions: readonly PermissionKey[] | ReadonlySet<PermissionKey>,
  isOwner: boolean,
): boolean {
  if (isOwner) return true;
  const definition = typeof widget === 'string' ? getDashboardWidget(widget) : widget;
  const has = (key: PermissionKey) => (permissions instanceof Set ? permissions.has(key) : (permissions as readonly PermissionKey[]).includes(key));
  return definition.requiredPermissions.every(has);
}

/** The period a card computes: its stored setting when valid, otherwise the card's default; null for cards without one. */
export function resolveWidgetPeriod(key: DashboardWidgetKey, settings: DashboardWidgetSettings | undefined): DashboardPeriod | null {
  const definition = getDashboardWidget(key);
  if (!definition.settings) return null;
  const stored = settings?.period;
  return stored && definition.settings.periods.includes(stored) ? stored : definition.settings.defaultPeriod;
}
