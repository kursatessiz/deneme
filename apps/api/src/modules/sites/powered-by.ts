import type { PrismaClient } from '@platform/database';
import { BRANDING_HIDE_BADGE_FLAG, resolvePoweredBy } from '@platform/shared';
import type { PoweredByDTO } from '@platform/shared';
import { resolveFeatureForStudio } from '../billing/add-ons/effective-feature';
import { sitesBaseDomain } from './sites.service';

type Db = Pick<PrismaClient, 'studio' | 'featureFlag' | 'studioAddOn'>;

/**
 * The "Powered by" badge of a tenant's public surfaces (docs/SEO.md). The `branding.hide_badge` flag resolves
 * like any other feature flag (tenant row, add-on entitlement, business type, global), so a premium plan add-on
 * or the super admin can hide it; the platform tenant never shows it.
 */
export async function loadPoweredBy(db: Db, studio: { id: string; slug: string; isPlatform: boolean }): Promise<PoweredByDTO> {
  const hideBadge = studio.isPlatform ? false : await resolveFeatureForStudio(db, studio.id, BRANDING_HIDE_BADGE_FLAG);
  return resolvePoweredBy({ isPlatform: studio.isPlatform, hideBadge, platformHost: sitesBaseDomain(), studioSlug: studio.slug });
}
