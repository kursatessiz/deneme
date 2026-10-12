/**
 * Build-time universal link / app link settings for the invite landing `/j/<token>`. Dependency free on
 * purpose: app.config.ts imports it while Expo evaluates the config. The domain is the web app's public
 * host (WEB_DOMAIN of the deployment), given as EXPO_PUBLIC_WEB_DOMAIN in the EAS environment; without
 * it the app keeps only its custom scheme and the invite link opens the web page.
 */

const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** The bare host from a value like `panel.example.com`; throws on anything else (scheme, path, port). */
export function parseWebDomain(value: string | undefined): string | null {
  const host = (value ?? '').trim();
  if (host === '') return null;
  if (!HOST_PATTERN.test(host)) throw new Error(`EXPO_PUBLIC_WEB_DOMAIN must be a bare host name such as panel.example.com, got "${host}"`);
  return host.toLowerCase();
}

export interface AndroidIntentFilter {
  action: 'VIEW';
  autoVerify: true;
  data: { scheme: 'https'; host: string; pathPrefix: '/j/' }[];
  category: ('BROWSABLE' | 'DEFAULT')[];
}

export interface UniversalLinkSettings {
  iosAssociatedDomains: string[];
  androidIntentFilters: AndroidIntentFilter[];
}

/** Settings claiming only `https://<domain>/j/*`; empty when no domain is configured. */
export function universalLinkSettings(domain: string | null): UniversalLinkSettings {
  if (!domain) return { iosAssociatedDomains: [], androidIntentFilters: [] };
  return {
    iosAssociatedDomains: [`applinks:${domain}`],
    androidIntentFilters: [{ action: 'VIEW', autoVerify: true, data: [{ scheme: 'https', host: domain, pathPrefix: '/j/' }], category: ['BROWSABLE', 'DEFAULT'] }],
  };
}
