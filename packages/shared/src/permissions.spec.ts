import { ALL_PERMISSIONS, DEFAULT_ROLE_TEMPLATES, isPermissionKey, resolvePermissions } from './permissions';

describe('permission catalogue', () => {
  it('default templates only reference catalogue keys', () => {
    for (const role of DEFAULT_ROLE_TEMPLATES) {
      for (const key of role.permissions) expect(isPermissionKey(key)).toBe(true);
    }
  });

  it('has exactly one owner template', () => {
    expect(DEFAULT_ROLE_TEMPLATES.filter((r) => r.isOwner)).toHaveLength(1);
  });

  it('owner resolves to every permission even if its stored list is stale', () => {
    expect(resolvePermissions({ isOwner: true, permissions: [] })).toEqual(ALL_PERMISSIONS);
  });

  it('drops unknown keys stored in the database', () => {
    expect(resolvePermissions({ isOwner: false, permissions: ['members.view', 'legacy.key'] })).toEqual([
      'members.view',
    ]);
  });

  it('trainers cannot see member contact details', () => {
    const trainer = DEFAULT_ROLE_TEMPLATES.find((r) => r.key === 'trainer')!;
    expect(trainer.permissions).not.toContain('members.contact.view');
    expect(trainer.permissions).toContain('attendance.manage');
  });
});
