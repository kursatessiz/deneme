import { filterNavByPermissions, hasAnyPermission, NAV_ITEMS } from './nav';

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
