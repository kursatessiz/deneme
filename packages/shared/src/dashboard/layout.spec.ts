import { DashboardLayoutSchema } from './layout';
import { DashboardDataRequestSchema } from './data';
import { canViewDashboardWidget, resolveWidgetPeriod } from './widgets';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function layout(items: unknown[]) {
  return { version: 1, items };
}

describe('DashboardLayoutSchema', () => {
  it('accepts a valid board', () => {
    const parsed = DashboardLayoutSchema.safeParse(
      layout([
        { id: id(1), widget: 'revenue', x: 0, y: 0, w: 3, h: 2, settings: { period: 'today' } },
        { id: id(2), widget: 'revenue', x: 3, y: 0, w: 3, h: 2, settings: { period: 'month' } },
        { id: id(3), widget: 'todaySchedule', x: 0, y: 2, w: 8, h: 5 },
      ]),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown widgets', () => {
    expect(DashboardLayoutSchema.safeParse(layout([{ id: id(1), widget: 'weather', x: 0, y: 0, w: 3, h: 2 }])).success).toBe(false);
  });

  it('rejects a second singleton', () => {
    const result = DashboardLayoutSchema.safeParse(
      layout([
        { id: id(1), widget: 'todaySchedule', x: 0, y: 0, w: 6, h: 5 },
        { id: id(2), widget: 'todaySchedule', x: 6, y: 0, w: 6, h: 5 },
      ]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects duplicate ids, cards past the right edge, fractions and negative positions', () => {
    expect(
      DashboardLayoutSchema.safeParse(
        layout([
          { id: id(1), widget: 'revenue', x: 0, y: 0, w: 3, h: 2 },
          { id: id(1), widget: 'activeMembers', x: 3, y: 0, w: 3, h: 2 },
        ]),
      ).success,
    ).toBe(false);
    expect(DashboardLayoutSchema.safeParse(layout([{ id: id(1), widget: 'revenue', x: 10, y: 0, w: 3, h: 2 }])).success).toBe(false);
    expect(DashboardLayoutSchema.safeParse(layout([{ id: id(1), widget: 'revenue', x: 0.5, y: 0, w: 3, h: 2 }])).success).toBe(false);
    expect(DashboardLayoutSchema.safeParse(layout([{ id: id(1), widget: 'revenue', x: 0, y: -1, w: 3, h: 2 }])).success).toBe(false);
  });

  it('rejects more than 30 cards', () => {
    const items = Array.from({ length: 31 }, (_, i) => ({ id: id(i + 1), widget: 'revenue', x: 0, y: i * 2, w: 3, h: 2 }));
    expect(DashboardLayoutSchema.safeParse(layout(items)).success).toBe(false);
  });

  it('rejects settings a card does not have, periods it does not offer and unknown fields', () => {
    expect(DashboardLayoutSchema.safeParse(layout([{ id: id(1), widget: 'todaySchedule', x: 0, y: 0, w: 6, h: 5, settings: { period: 'week' } }])).success).toBe(false);
    expect(DashboardLayoutSchema.safeParse(layout([{ id: id(1), widget: 'revenueTrend', x: 0, y: 0, w: 6, h: 4, settings: { period: 'today' } }])).success).toBe(false);
    expect(DashboardLayoutSchema.safeParse(layout([{ id: id(1), widget: 'revenue', x: 0, y: 0, w: 3, h: 2, settings: { color: 'red' } }])).success).toBe(false);
    expect(DashboardLayoutSchema.safeParse({ version: 1, items: [], extra: true }).success).toBe(false);
    expect(DashboardLayoutSchema.safeParse({ version: 2, items: [] }).success).toBe(false);
  });

  it('leaves sizes outside the widget limits to the server normalization (not a schema error)', () => {
    expect(DashboardLayoutSchema.safeParse(layout([{ id: id(1), widget: 'revenue', x: 0, y: 0, w: 12, h: 9 }])).success).toBe(true);
  });
});

describe('DashboardDataRequestSchema', () => {
  it('accepts a batch with an optional branch', () => {
    expect(DashboardDataRequestSchema.safeParse({ widgets: [{ id: id(1), widget: 'revenue', settings: { period: 'week' } }] }).success).toBe(true);
    expect(DashboardDataRequestSchema.safeParse({ branchId: id(9), widgets: [{ id: id(1), widget: 'lowStock' }] }).success).toBe(true);
  });

  it('rejects empty batches, unknown widgets and oversized batches', () => {
    expect(DashboardDataRequestSchema.safeParse({ widgets: [] }).success).toBe(false);
    expect(DashboardDataRequestSchema.safeParse({ widgets: [{ id: id(1), widget: 'nope' }] }).success).toBe(false);
    const many = Array.from({ length: 31 }, (_, i) => ({ id: id(i + 1), widget: 'revenue' }));
    expect(DashboardDataRequestSchema.safeParse({ widgets: many }).success).toBe(false);
  });
});

describe('widget permissions and periods', () => {
  it('lets the owner see everything and others only with every required permission', () => {
    expect(canViewDashboardWidget('revenue', [], true)).toBe(true);
    expect(canViewDashboardWidget('revenue', ['schedule.view'], false)).toBe(false);
    expect(canViewDashboardWidget('revenue', new Set(['reports.view'] as const), false)).toBe(true);
    expect(canViewDashboardWidget('branches', [], false)).toBe(true);
  });

  it('falls back to the default period for missing or invalid settings', () => {
    expect(resolveWidgetPeriod('revenue', undefined)).toBe('month');
    expect(resolveWidgetPeriod('revenue', { period: 'today' })).toBe('today');
    expect(resolveWidgetPeriod('revenueTrend', { period: 'today' })).toBe('last30');
    expect(resolveWidgetPeriod('todaySchedule', { period: 'week' })).toBeNull();
  });
});
