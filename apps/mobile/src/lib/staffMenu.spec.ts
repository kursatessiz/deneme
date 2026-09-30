import { buildHesabimMenu } from './staffMenu';

describe('buildHesabimMenu', () => {
  it('members get the chat with the studio; inbox.view adds the staff inbox', () => {
    const member = buildHesabimMenu({ permissions: [], isMember: true, isTrainer: false }).map((m) => m.key);
    expect(member).toContain('chat');
    expect(member).not.toContain('inbox');
    const reception = buildHesabimMenu({ permissions: ['inbox.view'], isMember: false, isTrainer: false }).map((m) => m.key);
    expect(reception).toContain('inbox');
    expect(reception).not.toContain('chat');
  });

  it('shows only the base menu for a plain member with no staff permissions', () => {
    const menu = buildHesabimMenu({ permissions: [], isMember: true, isTrainer: false });
    const keys = menu.map((m) => m.key);
    expect(keys).toContain('home-branch');
    expect(keys).toContain('qr-check-in');
    expect(keys).toContain('my-points');
    expect(keys).not.toContain('members');
    expect(keys).not.toContain('my-schedule');
    expect(keys).not.toContain('today-sessions');
  });

  it('members get the events screen; event check-in needs events.checkin and events.view', () => {
    expect(buildHesabimMenu({ permissions: [], isMember: true, isTrainer: false }).map((m) => m.key)).toContain('events');
    const reception = buildHesabimMenu({ permissions: ['events.view', 'events.checkin'], isMember: false, isTrainer: false }).map((m) => m.key);
    expect(reception).toContain('event-check-in');
    expect(reception).not.toContain('events');
    expect(buildHesabimMenu({ permissions: ['events.checkin'], isMember: false, isTrainer: false }).map((m) => m.key)).not.toContain('event-check-in');
  });

  it('members and staff with community.view get the community feed; others do not', () => {
    expect(buildHesabimMenu({ permissions: [], isMember: true, isTrainer: false }).map((m) => m.key)).toContain('community');
    expect(buildHesabimMenu({ permissions: ['community.view'], isMember: false, isTrainer: true }).map((m) => m.key)).toContain('community');
    expect(buildHesabimMenu({ permissions: ['schedule.view'], isMember: false, isTrainer: true }).map((m) => m.key)).not.toContain('community');
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

  it('shows the quick sale only with retail.sell', () => {
    const seller = buildHesabimMenu({ permissions: ['retail.sell'], isMember: false, isTrainer: false });
    const viewer = buildHesabimMenu({ permissions: ['retail.view'], isMember: false, isTrainer: false });
    expect(seller.find((m) => m.key === 'quick-sale')?.route).toBe('/(app)/hesabim/hizli-satis');
    expect(viewer.map((m) => m.key)).not.toContain('quick-sale');
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
        'billing.manage',
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

  it('shows the read-only add-ons screen only with billing.manage', () => {
    const owner = buildHesabimMenu({ permissions: ['billing.manage'], isMember: false, isTrainer: false });
    expect(owner.map((m) => m.key)).toContain('add-ons');
    const staff = buildHesabimMenu({ permissions: ['members.view'], isMember: false, isTrainer: false });
    expect(staff.map((m) => m.key)).not.toContain('add-ons');
  });

  it('shows the marketing approvals screen only with the platform permission platform.marketing.approve', () => {
    const approver = buildHesabimMenu({ permissions: [], isMember: false, isTrainer: false, platformPermissions: ['platform.marketing.view', 'platform.marketing.approve'] });
    expect(approver.map((m) => m.key)).toContain('marketing-approvals');
    expect(approver.find((m) => m.key === 'marketing-approvals')?.route).toBe('/(app)/hesabim/pazarlama-onaylari');
    const viewer = buildHesabimMenu({ permissions: [], isMember: false, isTrainer: false, platformPermissions: ['platform.marketing.view'] });
    expect(viewer.map((m) => m.key)).not.toContain('marketing-approvals');
    // A studio permission never stands in for the platform one.
    const owner = buildHesabimMenu({ permissions: ['billing.manage', 'campaigns.manage'], isMember: false, isTrainer: false });
    expect(owner.map((m) => m.key)).not.toContain('marketing-approvals');
  });
});
