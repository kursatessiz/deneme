import { DEFAULT_ROLE_TEMPLATES, resolvePermissions } from '../permissions';
import type { PermissionKey } from '../permissions';
import { buildDefaultDashboardLayout, filterDashboardLayout } from './defaults';
import { itemsCollide } from './engine';
import { DashboardLayoutSchema } from './layout';
import { canViewDashboardWidget } from './widgets';

function role(key: string): PermissionKey[] {
  const template = DEFAULT_ROLE_TEMPLATES.find((r) => r.key === key);
  if (!template) throw new Error(key);
  return resolvePermissions(template);
}

describe('buildDefaultDashboardLayout', () => {
  it('gives the owner figures, trends and the day without the reception-only cards', () => {
    const { items } = buildDefaultDashboardLayout([], true);
    const widgets = items.map((i) => i.widget);
    expect(widgets.slice(0, 5)).toEqual(['quickActions', 'revenue', 'activeMembers', 'occupancy', 'todaySessions']);
    expect(widgets).toEqual(expect.arrayContaining(['todaySchedule', 'branches', 'revenueTrend', 'occupancyTrend', 'recentPayments', 'lowStock', 'upcomingEvents']));
    expect(widgets).not.toContain('newLeads');
  });

  it('gives reception the day, payments and leads but no report figures', () => {
    const widgets = buildDefaultDashboardLayout(role('reception'), false).items.map((i) => i.widget);
    expect(widgets).toEqual(expect.arrayContaining(['quickActions', 'todaySessions', 'newLeads', 'todaySchedule', 'recentPayments', 'expiringPackages', 'lowStock']));
    expect(widgets).not.toContain('revenue');
    expect(widgets).not.toContain('revenueTrend');
  });

  it('gives a trainer the day and the week calendar only', () => {
    const widgets = buildDefaultDashboardLayout(role('trainer'), false).items.map((i) => i.widget);
    expect(widgets).toEqual(expect.arrayContaining(['quickActions', 'todaySessions', 'todaySchedule', 'weekCalendar', 'branches']));
    expect(widgets).not.toContain('revenue');
    expect(widgets).not.toContain('recentPayments');
  });

  it('builds valid, overlap-free, permission-respecting boards for every default role', () => {
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      const permissions = resolvePermissions(template);
      const layout = buildDefaultDashboardLayout(permissions, template.isOwner);
      expect(DashboardLayoutSchema.safeParse(layout).success).toBe(true);
      for (const item of layout.items) expect(canViewDashboardWidget(item.widget, permissions, template.isOwner)).toBe(true);
      for (let i = 0; i < layout.items.length; i += 1) {
        for (let j = i + 1; j < layout.items.length; j += 1) expect(itemsCollide(layout.items[i], layout.items[j])).toBe(false);
      }
    }
  });

  it('is stable between calls', () => {
    expect(buildDefaultDashboardLayout([], true)).toEqual(buildDefaultDashboardLayout([], true));
  });
});

describe('filterDashboardLayout', () => {
  it('drops forbidden cards and compacts', () => {
    const owner = buildDefaultDashboardLayout([], true).items;
    const filtered = filterDashboardLayout(owner, role('trainer'), false);
    expect(filtered.every((i) => canViewDashboardWidget(i.widget, role('trainer'), false))).toBe(true);
    expect(filtered.some((i) => i.widget === 'revenue')).toBe(false);
    expect(Math.min(...filtered.map((i) => i.y))).toBe(0);
  });
});
