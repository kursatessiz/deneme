import { OAUTH_PROVIDER_SLUGS, OAUTH_RETURN_PATHS, type IntegrationEntryPoint, type OAuthResult } from '@platform/shared';

/**
 * The only place the callback builds a redirect target. The origin is the
 * configured PUBLIC_APP_URL (scheme, host and port only: a path, query,
 * fragment or credentials in the setting are ignored or refused), the path
 * is one of the two fixed hub paths and the query holds fixed values only
 * (`oauth`, the provider slug, a reason code). Nothing from the provider or
 * the request is copied into it, so there is no open redirect.
 */
export function buildOAuthReturnUrl(appBaseUrl: string, returnTo: string, result: OAuthResult): string {
  const origin = safeOrigin(appBaseUrl);
  if (!origin) throw new Error('PUBLIC_APP_URL is not an http(s) origin');
  const entry: IntegrationEntryPoint = returnTo === 'admin' ? 'admin' : 'marketing';
  const query = new URLSearchParams({ oauth: result.ok ? 'ok' : 'error', provider: OAUTH_PROVIDER_SLUGS[result.provider] });
  if (!result.ok) query.set('reason', result.reason);
  return `${origin}${OAUTH_RETURN_PATHS[entry]}?${query.toString()}`;
}

/** The http(s) origin of a configured base URL, or null when it is not one (or carries credentials). */
export function safeOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/** True when `target` is exactly one of the redirects buildOAuthReturnUrl can produce for this base (tests and a runtime assertion). */
export function isAllowedReturnUrl(appBaseUrl: string, target: string): boolean {
  const origin = safeOrigin(appBaseUrl);
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.origin !== origin || url.hash || url.username || url.password) return false;
  return (Object.values(OAUTH_RETURN_PATHS) as string[]).includes(url.pathname);
}
