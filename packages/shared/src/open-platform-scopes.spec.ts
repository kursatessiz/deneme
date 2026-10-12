import { ALL_API_KEY_SCOPES, API_KEY_SCOPE_PERMISSIONS, PERMISSIONS, apiKeyScopesBeyondPermissions } from './index';

describe('API key scope permissions', () => {
  it('maps every scope to existing staff permissions', () => {
    for (const scope of ALL_API_KEY_SCOPES) {
      const keys = API_KEY_SCOPE_PERMISSIONS[scope];
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(Object.keys(PERMISSIONS)).toContain(key);
    }
  });

  it('reports the scopes a permission set does not cover', () => {
    const held = new Set(['schedule.view', 'members.view']);
    expect(apiKeyScopesBeyondPermissions(['schedules.read', 'members.read', 'crm.write'], held)).toEqual(['members.read', 'crm.write']);
  });
});
