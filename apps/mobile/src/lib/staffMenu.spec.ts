import { buildHesabimMenu } from './staffMenu';

describe('buildHesabimMenu', () => {
  it('shows only the base menu for a plain member with no staff permissions', () => {
    const menu = buildHesabimMenu({ permissions: [], isMember: true, isTrainer: false });
    const keys = menu.map((m) => m.key);
    expect(keys).toContain('home-branch');
    expect(keys).toContain('qr-check-in');
    expect(keys).not.toContain('members');
    expect(keys).not.toContain('my-schedule');
    expect(keys).not.toContain('today-sessions');
  });

  it('shows Programım only for a trainer with schedule.view', () => {
    const menu = buildHesabimMenu({ permissions: ['schedule.view'], isMember: false, isTrainer: true });
    expect(menu.map((m) => m.key)).toContain('my-schedule');
  });

  it('does not show Programım for a non-trainer even with schedule.view', () => {
    const menu = buildHesabimMenu({ permissions: ['schedule.view'], isMember: false, isTrainer: false });
    expect(menu.map((m) => m.key)).not.toContain('my-schedule');
  });

  it('shows reception entries for attendance.manage', () => {
    const menu = buildHesabimMenu({ permissions: ['attendance.manage'], isMember: false, isTrainer: false });
    const keys = menu.map((m) => m.key);
    expect(keys).toContain('today-sessions');
    expect(keys).toContain('member-qr-scan');
  });

  it('shows member management entries for members.view/manage', () => {
    const menu = buildHesabimMenu({
      permissions: ['members.view', 'members.manage'],
      isMember: false,
      isTrainer: false,
    });
    const keys = menu.map((m) => m.key);
    expect(keys).toContain('members');
    expect(keys).toContain('new-member');
  });

  it('shows session creation only with schedule.manage', () => {
    const withPermission = buildHesabimMenu({ permissions: ['schedule.manage'], isMember: false, isTrainer: false });
    const without = buildHesabimMenu({ permissions: [], isMember: false, isTrainer: false });
    expect(withPermission.map((m) => m.key)).toContain('new-session');
    expect(without.map((m) => m.key)).not.toContain('new-session');
  });

  it('every menu item has a unique key and a route under /(app)/', () => {
    const menu = buildHesabimMenu({
      permissions: [
        'members.view',
        'members.manage',
        'schedule.view',
        'schedule.manage',
        'attendance.manage',
        'reports.view',
        'leads.view',
        'studio.settings.manage',
        'notifications.manage',
        'integrations.manage',
        'integrations.partners.manage',
        'content.manage',
        'commissions.view.all',
      ],
      isMember: true,
      isTrainer: true,
    });
    const keys = menu.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of menu) {
      expect(item.route.startsWith('/(app)/')).toBe(true);
    }
  });
});
