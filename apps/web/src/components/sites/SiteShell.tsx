import { DEFAULT_TENANT_THEME, PRODUCT_NAME, type PublicSiteSettingsDTO, type TenantTheme, type Translate } from '@platform/shared';
import { CookiePreferencesButton } from '@/components/consent/CookiePreferencesButton';
import { PublicTracking } from '@/components/consent/PublicTracking';
import { ThemeRoot } from '@/components/theme/ThemeRoot';
import { PoweredByBadge } from '@/components/branding/PoweredByBadge';

/**
 * The public chrome shared by page engine pages and blog pages: the site's brand theme (platform default or
 * the tenant's own, CLAUDE.md rule 10), consent-gated tracking, structured data scripts, and the footer with
 * the cookie preferences button. Server rendered; only tracking and consent are client JS.
 */
export function SiteShell({
  theme,
  studioSlug,
  cookieLabel,
  jsonLd,
  banner,
  poweredBy,
  children,
}: {
  theme: TenantTheme | null | undefined;
  studioSlug: string;
  cookieLabel: string;
  /** Script bodies already serialized with serializeJsonLd(). */
  jsonLd: readonly string[];
  banner?: React.ReactNode;
  /** Plan-gated "Powered by" badge (docs/SEO.md); omitted or a null url renders nothing. */
  poweredBy?: { url: string | null; label: string } | null;
  children: React.ReactNode;
}) {
  return (
    <ThemeRoot tenantTheme={theme ?? DEFAULT_TENANT_THEME} appearance={{ themeFamily: null, colorScheme: 'SYSTEM' }}>
      <PublicTracking studioSlug={studioSlug} />
      {jsonLd.map((doc, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: doc }} />
      ))}

      <div className="min-h-screen flex flex-col">
        {banner}
        <main className="flex-1">{children}</main>
        <footer className="ui-rule px-4 py-4 text-center ui-caption flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <CookiePreferencesButton label={cookieLabel} />
          {poweredBy && <PoweredByBadge href={poweredBy.url} label={poweredBy.label} />}
        </footer>
      </div>
    </ThemeRoot>
  );
}

/** The footer badge props from a site's public settings; a hidden badge has a null url. */
export function poweredByOf(settings: PublicSiteSettingsDTO, t: Translate): { url: string | null; label: string } {
  return { url: settings.showPoweredBy ? settings.poweredByUrl : null, label: t('branding.poweredBy', { product: PRODUCT_NAME }) };
}
