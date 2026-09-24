import { ALL_PERMISSIONS } from '@platform/shared';
import { diffRolePermissions, groupPermissionsByArea } from './role-permission-grouping';

describe('groupPermissionsByArea', () => {
  it('covers every catalogue permission exactly once', () => {
    const groups = groupPermissionsByArea();
    const flattened = groups.flatMap((g) => g.permissions.map((p) => p.key));
    expect(flattened.sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(new Set(flattened).size).toBe(flattened.length);
  });

  it('every permission has a non-empty Turkish label', () => {
    const groups = groupPermissionsByArea();
    for (const group of groups) {
      for (const p of group.permissions) {
        expect(p.label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('diffRolePermissions', () => {
  it('reports additions and removals', () => {
    const diff = diffRolePermissions(['members.view', 'catalog.view'], ['members.view', 'schedule.view']);
    expect(diff.added).toEqual(['schedule.view']);
    expect(diff.removed).toEqual(['catalog.view']);
  });

  it('is empty when nothing changed', () => {
    const diff = diffRolePermissions(['members.view'], ['members.view']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });
});
