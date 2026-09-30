import { FeatureFlagScope } from '@platform/database';
import type { PrismaClient } from '@platform/database';
import { addOnHasAccess, resolveEffectiveFeature } from '@platform/shared';

/**
 * Effective feature flag of a tenant, layering add-on entitlements on the
 * existing scopes (G5c-2): an explicit TENANT row wins, otherwise a
 * `studio_add_ons` row that currently has access (ACTIVE, TRIALING before its
 * end, CANCELLED before its period end) turns the flag on, otherwise
 * BUSINESS_TYPE, then GLOBAL. The pure rule is `resolveEffectiveFeature` in
 * @platform/shared; this file only loads the inputs.
 *
 * The single-key reader keeps the query order of the original resolver
 * (TENANT, BUSINESS_TYPE, GLOBAL) so callers and tests that depend on it are
 * unchanged.
 */

type Db = Pick<PrismaClient, 'studio' | 'featureFlag' | 'studioAddOn'>;

export async function resolveFeatureForStudio(db: Db, studioId: string, key: string, now: Date = new Date()): Promise<boolean> {
  const studio = await db.studio.findUnique({ where: { id: studioId }, select: { businessTypeTemplateId: true } });

  const [tenantFlag, businessTypeFlag, globalFlag, addOnRows] = await Promise.all([
    db.featureFlag.findFirst({ where: { key, scope: FeatureFlagScope.TENANT, studioId } }),
    studio?.businessTypeTemplateId
      ? db.featureFlag.findFirst({ where: { key, scope: FeatureFlagScope.BUSINESS_TYPE, businessTypeTemplateId: studio.businessTypeTemplateId } })
      : Promise.resolve(null),
    db.featureFlag.findFirst({ where: { key, scope: FeatureFlagScope.GLOBAL } }),
    db.studioAddOn.findMany({
      where: { studioId, status: { not: 'EXPIRED' }, addOn: { featureFlagKey: key } },
      select: { status: true, trialEndsAt: true, currentPeriodEnd: true },
    }),
  ]);

  return resolveEffectiveFeature({
    tenant: tenantFlag ? tenantFlag.enabled : null,
    addOnEntitled: addOnRows.some((row) => addOnHasAccess(row, now)),
    businessType: businessTypeFlag ? businessTypeFlag.enabled : null,
    global: globalFlag ? globalFlag.enabled : null,
  });
}

/**
 * The same resolution for many keys at once (module-off empty states):
 * three queries in total instead of three per key.
 */
export async function resolveFeaturesForStudio(db: Db, studioId: string, keys: readonly string[], now: Date = new Date()): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (keys.length === 0) return result;
  const studio = await db.studio.findUnique({ where: { id: studioId }, select: { businessTypeTemplateId: true } });
  const [flags, addOnRows] = await Promise.all([
    db.featureFlag.findMany({
      where: {
        key: { in: [...keys] },
        OR: [
          { scope: FeatureFlagScope.TENANT, studioId },
          ...(studio?.businessTypeTemplateId ? [{ scope: FeatureFlagScope.BUSINESS_TYPE, businessTypeTemplateId: studio.businessTypeTemplateId }] : []),
          { scope: FeatureFlagScope.GLOBAL },
        ],
      },
      select: { key: true, scope: true, enabled: true },
    }),
    db.studioAddOn.findMany({
      where: { studioId, status: { not: 'EXPIRED' }, addOn: { featureFlagKey: { in: [...keys] } } },
      select: { status: true, trialEndsAt: true, currentPeriodEnd: true, addOn: { select: { featureFlagKey: true } } },
    }),
  ]);
  for (const key of keys) {
    const scoped = (scope: FeatureFlagScope): boolean | null => {
      const row = flags.find((f) => f.key === key && f.scope === scope);
      return row ? row.enabled : null;
    };
    result.set(
      key,
      resolveEffectiveFeature({
        tenant: scoped(FeatureFlagScope.TENANT),
        addOnEntitled: addOnRows.some((row) => row.addOn.featureFlagKey === key && addOnHasAccess(row, now)),
        businessType: scoped(FeatureFlagScope.BUSINESS_TYPE),
        global: scoped(FeatureFlagScope.GLOBAL),
      }),
    );
  }
  return result;
}
