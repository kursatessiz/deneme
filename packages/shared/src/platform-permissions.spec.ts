import {
  ALL_PLATFORM_PERMISSIONS,
  DEFAULT_PLATFORM_ROLE_TEMPLATES,
  PLATFORM_ACCESS_TRANSLATED_ERRORS,
  PLATFORM_PERMISSION_AREAS,
  PLATFORM_TENANT_GRANTS,
  RecoveryCodeSchema,
  isForbiddenPlatformTenantGrant,
  isPlatformSystemRoleKey,
  platformSystemRoleKey,
  resolvePlatformPermissions,
  resolvePlatformTenantPermissions,
} from './platform-permissions';
import { ALL_PERMISSIONS, isPermissionKey } from './permissions';
import { BASE_MESSAGES } from './i18n/messages';
import { TRANSLATED_API_ERROR_CODES } from './billing';

describe('platform permission catalogue', () => {
  it('groups every key in exactly one area', () => {
    const grouped = Object.values(PLATFORM_PERMISSION_AREAS).flat();
    expect([...grouped].sort()).toEqual([...ALL_PLATFORM_PERMISSIONS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('maps only to real tenant keys', () => {
    for (const keys of Object.values(PLATFORM_TENANT_GRANTS)) {
      for (const key of keys) expect(isPermissionKey(key)).toBe(true);
    }
  });

  it('never yields role, staff, settings, billing or finance keys, even for every platform key at once', () => {
    const all = resolvePlatformTenantPermissions(ALL_PLATFORM_PERMISSIONS);
    for (const forbidden of ['roles.manage', 'staff.manage', 'studio.settings.manage', 'billing.manage', 'payroll.manage', 'accounting.export']) {
      expect(all).not.toContain(forbidden);
    }
    expect(all.filter((k) => /^(finance|payouts|commissions|payroll|accounting|billing)\./.test(k))).toEqual([]);
    // The guard list agrees with the whole tenant catalogue: no forbidden key is reachable through any grant.
    for (const tenantKey of ALL_PERMISSIONS) {
      if (isForbiddenPlatformTenantGrant(tenantKey)) expect(all).not.toContain(tenantKey);
    }
  });

  it('derives the marketing admin tenant permissions per the design (doc 2.3)', () => {
    const marketing = DEFAULT_PLATFORM_ROLE_TEMPLATES.find((t) => t.key === 'marketing_admin');
    expect(marketing).toBeDefined();
    const tenant = resolvePlatformTenantPermissions(marketing!.permissions);
    expect(tenant).toEqual(
      expect.arrayContaining(['crm.view', 'crm.manage', 'segments.manage', 'campaigns.manage', 'journeys.manage', 'ads.manage', 'integrations.manage', 'ai.use', 'inbox.reply']),
    );
    // Export stays off by default.
    expect(tenant).not.toContain('crm.export');
    expect(marketing!.permissions).not.toContain('platform.marketing.approve');
    expect(marketing!.permissions).not.toContain('platform.users.manage');
  });

  it('drops unknown and super-admin-only keys from a stored template', () => {
    expect(resolvePlatformPermissions(['platform.ads.view', 'platform.users.manage', 'nope', 'crm.view'])).toEqual(['platform.ads.view']);
    expect(resolvePlatformTenantPermissions(['nope', 'crm.view'])).toEqual([]);
  });

  it('names system roles with a prefix a tenant role key can never produce', () => {
    expect(platformSystemRoleKey('marketing_admin')).toBe('platform:marketing_admin');
    expect(isPlatformSystemRoleKey('platform:marketing_admin')).toBe(true);
    expect(isPlatformSystemRoleKey('platform-ekibi-abc123')).toBe(false);
  });

  it('translates every platform access error code', () => {
    for (const [code, key] of Object.entries(PLATFORM_ACCESS_TRANSLATED_ERRORS)) {
      expect(TRANSLATED_API_ERROR_CODES[code]).toBe(key);
      expect(BASE_MESSAGES[key]).toBeTruthy();
    }
  });

  it('normalizes recovery codes typed with dashes, spaces or capitals', () => {
    expect(RecoveryCodeSchema.parse('ABCDE-FGH23')).toBe('abcdefgh23');
    expect(RecoveryCodeSchema.safeParse('abc').success).toBe(false);
  });
});
