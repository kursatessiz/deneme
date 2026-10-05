import type { PermissionKey } from '../permissions';
import { DASHBOARD_GRID } from './grid';
import { compact, findFirstFit } from './engine';
import { canViewDashboardWidget, getDashboardWidget } from './widgets';
import type { DashboardWidgetKey } from './widgets';
import type { DashboardLayout, DashboardLayoutItem } from './layout';

/**
 * The board a membership sees before it customises anything, and after
 * "Varsayılana dön". One ordered list for every role: cards the membership
 * may not see are skipped and the rest are packed in order, so an owner
 * starts with figures, trends and the day's program, reception with the
 * day's program, payments and expiring packages, and a trainer with the
 * day's program and the week calendar.
 */
export const DASHBOARD_DEFAULT_ORDER: readonly { widget: DashboardWidgetKey; w?: number; h?: number }[] = [
  { widget: 'quickActions' },
  { widget: 'revenue' },
  { widget: 'activeMembers' },
  { widget: 'occupancy' },
  { widget: 'todaySessions' },
  { widget: 'newLeads', w: 4 },
  { widget: 'todaySchedule', w: 8 },
  { widget: 'branches', h: 5 },
  { widget: 'revenueTrend' },
  { widget: 'occupancyTrend' },
  { widget: 'recentPayments' },
  { widget: 'expiringPackages' },
  { widget: 'weekCalendar', w: 12 },
  { widget: 'lowStock' },
  { widget: 'upcomingEvents' },
];

/** Widgets an owner would get that make the owner's first board too long are dropped for owners only. */
const OWNER_SKIPS: readonly DashboardWidgetKey[] = ['newLeads', 'expiringPackages', 'weekCalendar'];

/** Stable ids for default cards, so a default board reads the same on every request. */
export function defaultDashboardItemId(index: number): string {
  return `d0a5b0a1-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

export function buildDefaultDashboardLayout(permissions: readonly PermissionKey[] | ReadonlySet<PermissionKey>, isOwner: boolean): DashboardLayout {
  const items: DashboardLayoutItem[] = [];
  DASHBOARD_DEFAULT_ORDER.forEach((entry, index) => {
    if (isOwner && OWNER_SKIPS.includes(entry.widget)) return;
    if (!canViewDashboardWidget(entry.widget, permissions, isOwner)) return;
    const { size } = getDashboardWidget(entry.widget);
    const w = Math.min(Math.max(entry.w ?? size.defaultW, size.minW), size.maxW);
    const h = Math.min(Math.max(entry.h ?? size.defaultH, size.minH), size.maxH);
    const { x, y } = findFirstFit(items, w, h, DASHBOARD_GRID.columns);
    items.push({ id: defaultDashboardItemId(index), widget: entry.widget, x, y, w, h });
  });
  return { version: DASHBOARD_GRID.version, items: compact(items) };
}

/**
 * Drops the cards the membership may not see (a role changed, a stale
 * board) and compacts the rest. The GET and PUT layout endpoints apply it.
 */
export function filterDashboardLayout(
  items: readonly DashboardLayoutItem[],
  permissions: readonly PermissionKey[] | ReadonlySet<PermissionKey>,
  isOwner: boolean,
): DashboardLayoutItem[] {
  return compact(items.filter((item) => canViewDashboardWidget(item.widget, permissions, isOwner)));
}
