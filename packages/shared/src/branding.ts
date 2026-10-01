/**
 * Passive acquisition badge ("Powered by <product>") on tenant public surfaces (docs/SEO.md "Powered by rozeti").
 * The badge is plan-gated through the `branding.hide_badge` feature flag: absent or off means the badge is
 * shown, on (a premium plan or add-on entitles it, or the super admin sets it for one tenant) hides it.
 * The platform tenant's own surfaces never show it.
 */

/** Feature flag that hides the badge for a tenant (default off, see FEATURE_FLAGS). */
export const BRANDING_HIDE_BADGE_FLAG = 'branding.hide_badge';

/** UTM source and medium of every badge link; the campaign is the tenant's studio slug. */
export const POWERED_BY_UTM_SOURCE = 'tenant-site';
export const POWERED_BY_UTM_MEDIUM = 'badge';

/** `https://<host>`; plain http only for the local development host. */
export function originForPlatformHost(host: string): string {
  const protocol = host === 'localhost' || host.startsWith('localhost:') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${protocol}://${host}`;
}

/**
 * Badge link: the platform site origin with the attribution query. `platformHost` is the platform base domain
 * (SITES_DOMAIN, else WEB_DOMAIN). The origin root redirects to the visitor's locale and keeps the query.
 */
export function buildPoweredByUrl(platformHost: string, studioSlug: string): string {
  const query = `utm_source=${POWERED_BY_UTM_SOURCE}&utm_medium=${POWERED_BY_UTM_MEDIUM}&utm_campaign=${encodeURIComponent(studioSlug)}`;
  return `${originForPlatformHost(platformHost)}/?${query}`;
}

/** Whether a public surface of a tenant renders the badge. The platform tenant never does. */
export function shouldShowPoweredBy(input: { isPlatform: boolean; hideBadge: boolean }): boolean {
  return !input.isPlatform && !input.hideBadge;
}

/** What the public config endpoints expose about the badge. `poweredByUrl` is null whenever the badge is hidden. */
export interface PoweredByDTO {
  showPoweredBy: boolean;
  poweredByUrl: string | null;
}

export function resolvePoweredBy(input: { isPlatform: boolean; hideBadge: boolean; platformHost: string; studioSlug: string }): PoweredByDTO {
  const show = shouldShowPoweredBy(input);
  return { showPoweredBy: show, poweredByUrl: show ? buildPoweredByUrl(input.platformHost, input.studioSlug) : null };
}
