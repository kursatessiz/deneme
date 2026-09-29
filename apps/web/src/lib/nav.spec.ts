import { filterNavByPermissions, hasAnyPermission, NAV_ITEMS } from './nav';
import { visibleQuickActions } from './quick-actions';

describe('filterNavByPermissions', () => {
  it('owners see every nav item regardless of their stored permission list', () => {
    const items = filterNavByPermissions(NAV_ITEMS, [], true);
    expect(items.map((i) => i.key)).toEqual(NAV_ITEMS.map((i) => i.key));
  });

  it('a trainer (schedule.view only) sees dashboard, calendar and trainers, not members or packages', () => {
    const items = filterNavByPermissions(NAV_ITEMS, ['schedule.view'], false);
    const keys = items.map((i) => i.key);
    expect(keys).toContain('dashboard');
    expect(keys).toContain('calendar');
    expect(keys).toContain('trainers');
    expect(keys).not.toContain('members');
    expect(keys).not.toContain('packages');
  });

  it('a member with no staff permissions sees only the permission-less items', () => {
    const items = filterNavByPermissions(NAV_ITEMS, [], false);
    expect(items.map((i) => i.key)).toEqual(['dashboard']);
  });

  it('reception (members.view + catalog.view, no schedule.view) sees members and packages, not calendar/trainers', () => {
    const items = filterNavByPermissions(NAV_ITEMS, ['members.view', 'catalog.view'], false);
    const keys = items.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['dashboard', 'members', 'packages']));
    expect(keys).not.toContain('calendar');
    expect(keys).not.toContain('trainers');
  });

  it('a manager with roles.manage sees settings; a trainer without any settings permission does not', () => {
    const manager = filterNavByPermissions(NAV_ITEMS, ['roles.manage'], false);
    expect(manager.map((i) => i.key)).toContain('settings');
    const trainer = filterNavByPermissions(NAV_ITEMS, ['schedule.view'], false);
    expect(trainer.map((i) => i.key)).not.toContain('settings');
  });
});

describe('inbox navigation', () => {
  it('reception with inbox.view sees the inbox; a trainer without it does not', () => {
    expect(filterNavByPermissions(NAV_ITEMS, ['members.view', 'inbox.view'], false).map((i) => i.key)).toContain('inbox');
    expect(filterNavByPermissions(NAV_ITEMS, ['schedule.view'], false).map((i) => i.key)).not.toContain('inbox');
  });
});

describe('events navigation', () => {
  it('events.view unlocks the events page; a trainer without it does not see it', () => {
    expect(filterNavByPermissions(NAV_ITEMS, ['events.view', 'events.checkin'], false).map((i) => i.key)).toContain('events');
    expect(filterNavByPermissions(NAV_ITEMS, ['schedule.view', 'attendance.manage'], false).map((i) => i.key)).not.toContain('events');
  });
});

describe('hasAnyPermission', () => {
  it('an item with no required permissions is always visible', () => {
    expect(hasAnyPermission([], [], false)).toBe(true);
  });

  it('owners always pass regardless of required permissions', () => {
    expect(hasAnyPermission(['finance.manage'], [], true)).toBe(true);
  });

  it('grants when the effective set contains any of the required permissions', () => {
    expect(hasAnyPermission(['schedule.view', 'bookings.view'], ['bookings.view'], false)).toBe(true);
  });

  it('denies when none of the required permissions are held', () => {
    expect(hasAnyPermission(['finance.manage'], ['members.view'], false)).toBe(false);
  });
});

describe('retail navigation and quick sale', () => {
  it('shows the store to retail.view and the quick sale action to retail.sell only', () => {
    expect(filterNavByPermissions(NAV_ITEMS, ['retail.view'], false).map((i) => i.key)).toContain('retail');
    expect(filterNavByPermissions(NAV_ITEMS, ['schedule.view'], false).map((i) => i.key)).not.toContain('retail');
    expect(visibleQuickActions(['retail.sell'], false).map((a) => a.key)).toEqual(['quick-sale']);
    expect(visibleQuickActions(['retail.view'], false).map((a) => a.key)).not.toContain('quick-sale');
    expect(visibleQuickActions([], true).map((a) => a.key)).toContain('quick-sale');
  });
});
