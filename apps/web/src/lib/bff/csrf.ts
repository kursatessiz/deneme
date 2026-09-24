/**
 * CSRF defense for the BFF proxy. Browsers never send this custom header on
 * a cross-site form submission or simple request, and a cross-site fetch
 * that adds it would trigger a CORS preflight the API's origin list would
 * reject anyway -- so requiring it on every state-changing call is enough,
 * without a separate token to issue and verify.
 */
export const CSRF_HEADER_NAME = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'platform-web';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function methodNeedsCsrfCheck(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export function hasValidCsrfHeader(headers: Pick<Headers, 'get'>): boolean {
  return headers.get(CSRF_HEADER_NAME) === CSRF_HEADER_VALUE;
}

/**
 * The request's Origin must name the same host the request was sent to.
 * `origin` is whatever the `Origin` header carried (or null - absent on
 * same-site navigations in some browsers, which is fine since GET/HEAD
 * never reach this check). `host` is the Host header of the incoming
 * request (what the browser is talking to).
 */
export function isSameOriginRequest(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  return originHost === host;
}
