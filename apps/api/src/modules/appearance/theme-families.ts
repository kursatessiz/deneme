import { FeatureFlagScope } from '@platform/database';
import type { PrismaClient } from '@platform/database';
import { OPTIONAL_THEME_FAMILY_KEYS, resolveAllowedThemeFamilies, themeFamilyFlagKey } from '@platform/shared';
import type { ThemeFamilyKey } from '@platform/shared';

type Db = Pick<PrismaClient, 'featureFlag'>;

const FLAG_KEYS = OPTIONAL_THEME_FAMILY_KEYS.map(themeFamilyFlagKey);

/**
 * Theme families the super admin allowed, per studio. One query for any
 * number of studios: tenant rows and global rows of the `theme_family.*`
 * flags, folded by the pure rule in @platform/shared (a tenant row wins over
 * a global one; the default family is always included). Business-type rows
 * are not consulted: the allow-list is a per-studio super-admin decision.
 */
export async function loadAllowedThemeFamilies(db: Db, studioIds: readonly string[]): Promise<Map<string, ThemeFamilyKey[]>> {
  const result = new Map<string, ThemeFamilyKey[]>();
  if (studioIds.length === 0) return result;
  const rows = await db.featureFlag.findMany({
    where: {
      key: { in: FLAG_KEYS },
      OR: [{ scope: FeatureFlagScope.GLOBAL }, { scope: FeatureFlagScope.TENANT, studioId: { in: [...studioIds] } }],
    },
    select: { key: true, scope: true, studioId: true, enabled: true },
  });
  for (const id of studioIds) {
    const applicable = rows
      .filter((r) => r.scope === FeatureFlagScope.GLOBAL || r.studioId === id)
      .map((r) => ({ key: r.key, scope: r.scope === FeatureFlagScope.GLOBAL ? ('GLOBAL' as const) : ('TENANT' as const), enabled: r.enabled }));
    result.set(id, resolveAllowedThemeFamilies(applicable));
  }
  return result;
}

export async function loadAllowedThemeFamiliesForStudio(db: Db, studioId: string): Promise<ThemeFamilyKey[]> {
  return (await loadAllowedThemeFamilies(db, [studioId])).get(studioId) ?? resolveAllowedThemeFamilies([]);
}
