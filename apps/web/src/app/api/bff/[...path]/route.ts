import { requestTranslator } from '@/lib/bff/request-translator';
import { NextRequest, NextResponse } from 'next/server';
import { apiInternalBaseUrl } from '@/lib/server-env';
import { sanitizeApiPath } from '@/lib/bff/path';
import { hasValidCsrfHeader, isSameOriginRequest, methodNeedsCsrfCheck } from '@/lib/bff/csrf';
import { stripHopByHopHeaders } from '@/lib/bff/headers';
import { buildPassthroughResponseInit, isJsonResponse, isNullBodyStatus } from '@/lib/bff/proxy-response';
import {
  ACCESS_TOKEN_COOKIE,
  ACTIVE_STUDIO_COOKIE,
  REFRESH_TOKEN_COOKIE,
  accessTokenCookieOptions,
  expiredCookieOptions,
  refreshTokenCookieOptions,
} from '@/lib/bff/cookies';
import { isLogoutPath, isSessionUpgradePath, isTokenIssuingPath } from '@/lib/bff/auth-paths';
import { translateApiError } from '@/lib/bff/translate-error';
import { PW_LOCALE_COOKIE } from '@/lib/i18n/constants';
import { ERROR_CODE_HEADER, REQUEST_ID_HEADER } from '@platform/shared';
import { reportServerError, requestIdFrom } from '@/lib/errors/server';

/**
 * Backend-for-frontend proxy. Every `/api/bff/<path>` call from the browser
 * lands here and is forwarded to the API at a fixed, server-only base URL
 * (`API_INTERNAL_URL`) -- never to a host the client controls. See
 * docs/WEB_PANEL.md for the full design.
 */

const LOCALE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

async function forward(
  req: NextRequest,
  apiPath: string,
  accessToken: string | null,
  body: ArrayBuffer | undefined,
  requestId: string,
): Promise<Response> {
  const url = new URL(`${apiInternalBaseUrl()}/${apiPath}${req.nextUrl.search}`);
  const headers = stripHopByHopHeaders(req.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  // The viewer's explicit language (pw_locale cookie) goes to the API as Accept-Language, so any
  // server-rendered text it still produces follows the same language as the translated errors.
  const localeCookie = req.cookies.get(PW_LOCALE_COOKIE)?.value;
  if (localeCookie && LOCALE_TAG.test(localeCookie)) headers.set('accept-language', localeCookie);

  const studioId = req.headers.get('x-studio-id') ?? req.cookies.get(ACTIVE_STUDIO_COOKIE)?.value;
  if (studioId) headers.set('x-studio-id', studioId);

  const hasBody = body !== undefined && body.byteLength > 0;
  if (hasBody) {
    headers.set('content-type', headers.get('content-type') ?? 'application/json');
  }

  return fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? body : undefined,
    redirect: 'manual',
    // Next.js's patched fetch() otherwise applies its data cache to GET
    // requests by URL, independent of this route handler's own dynamic
    // rendering -- silently serving a stale response (e.g. a role list
    // missing a role created moments ago) to every request that follows
    // the first, for as long as the server process lives.
    cache: 'no-store',
  });
}

async function refreshAccessToken(refreshToken: string): Promise<TokenPair | null> {
  const res = await fetch(`${apiInternalBaseUrl()}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Partial<TokenPair>;
  if (!data.accessToken || !data.refreshToken) return null;
  return { accessToken: data.accessToken, refreshToken: data.refreshToken };
}

function setSessionCookies(res: NextResponse, tokens: TokenPair) {
  res.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, accessTokenCookieOptions(process.env.NODE_ENV));
  res.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, refreshTokenCookieOptions(process.env.NODE_ENV));
}

function clearSessionCookies(res: NextResponse) {
  res.cookies.set(ACCESS_TOKEN_COOKIE, '', expiredCookieOptions(process.env.NODE_ENV));
  res.cookies.set(REFRESH_TOKEN_COOKIE, '', expiredCookieOptions(process.env.NODE_ENV));
}

async function toNextResponse(
  apiRes: Response,
  dropKeys: readonly string[] = [],
  req?: NextRequest,
): Promise<{ body: unknown; res: NextResponse }> {
  if (!isJsonResponse(apiRes)) {
    const { status, headers } = buildPassthroughResponseInit(apiRes);
    // A 204 (e.g. a delete) has no body; passing even an empty buffer throws.
    const buf = isNullBodyStatus(status) ? null : await apiRes.arrayBuffer();
    const res = new NextResponse(buf, { status });
    headers.forEach((value, key) => res.headers.set(key, value));
    return { body: null, res };
  }
  const json = (await apiRes.json().catch(() => null)) as Record<string, unknown> | null;
  const kept = json && dropKeys.length > 0 ? Object.fromEntries(Object.entries(json).filter(([k]) => !dropKeys.includes(k))) : json;
  // Error codes with a shared translation (e.g. BILLING_RESTRICTED) reach the browser in the viewer's language.
  const filtered =
    !apiRes.ok && req ? translateApiError(kept, req.cookies.get(PW_LOCALE_COOKIE)?.value, req.headers.get('accept-language')) : kept;
  const res = NextResponse.json(filtered, { status: apiRes.status });
  const errorCode = apiRes.headers.get(ERROR_CODE_HEADER);
  if (errorCode) res.headers.set(ERROR_CODE_HEADER, errorCode);
  return { body: filtered, res };
}

async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }, requestId: string): Promise<NextResponse> {
  const t = requestTranslator(req);
  const { path } = await context.params;
  const apiPath = sanitizeApiPath(path);
  if (!apiPath) {
    return NextResponse.json({ message: t('common.error.invalidRequestPath') }, { status: 400 });
  }

  if (methodNeedsCsrfCheck(req.method)) {
    const originOk = isSameOriginRequest(req.headers.get('origin'), req.headers.get('host'));
    if (!originOk || !hasValidCsrfHeader(req.headers)) {
      return NextResponse.json({ message: t('common.error.invalidRequestOrigin') }, { status: 403 });
    }
  }

  const accessToken = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
  const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value ?? null;
  // Read the body once: a refresh-and-retry must replay the same bytes.
  const requestBody = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();

  // auth/login, auth/otp/verify, auth/pin/login: the body carries tokens
  // that must become cookies and never reach the browser as JSON.
  if (isTokenIssuingPath(apiPath) && req.method === 'POST') {
    const apiRes = await forward(req, apiPath, isSessionUpgradePath(apiPath) ? accessToken : null, requestBody, requestId);
    if (!apiRes.ok) return (await toNextResponse(apiRes, [], req)).res as NextResponse;
    // Read the tokens from the API's own JSON, then send the browser the
    // same payload without them.
    const json = ((await apiRes.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const { accessToken: issuedAccess, refreshToken: issuedRefresh, ...rest } = json;
    const res = NextResponse.json(rest, { status: apiRes.status });
    if (typeof issuedAccess === 'string' && typeof issuedRefresh === 'string') {
      setSessionCookies(res, { accessToken: issuedAccess, refreshToken: issuedRefresh });
    }
    return res;
  }

  if (isLogoutPath(apiPath) && req.method === 'POST') {
    if (accessToken) await forward(req, apiPath, accessToken, requestBody, requestId).catch(() => undefined);
    const res = new NextResponse(null, { status: 204 });
    clearSessionCookies(res);
    return res;
  }

  let apiRes = await forward(req, apiPath, accessToken, requestBody, requestId);
  // A 5xx the API recorded itself carries x-error-code; anything else
  // (a crash before the API's filter, a proxy error) is recorded here.
  if (apiRes.status >= 500 && !apiRes.headers.get(ERROR_CODE_HEADER)) {
    reportServerError({ type: 'UpstreamError', message: `API answered ${apiRes.status}`, route: `${req.method} /${apiPath}`, requestId });
  }

  if (apiRes.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed) {
      apiRes = await forward(req, apiPath, refreshed.accessToken, requestBody, requestId);
      const { res } = await toNextResponse(apiRes);
      setSessionCookies(res, refreshed);
      return res;
    }
    const { res } = await toNextResponse(apiRes);
    clearSessionCookies(res);
    return res;
  }

  const { res } = await toNextResponse(apiRes, [], req);
  return res;
}

/**
 * Every BFF call carries a correlation id to the API (x-request-id, the
 * browser's when well formed) and echoes it. An unreachable API is
 * recorded as an error and answered with 502.
 */
async function handleWithRequestId(req: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const requestId = requestIdFrom(req.headers);
  let res: NextResponse;
  try {
    res = await handle(req, context, requestId);
  } catch (err) {
    reportServerError({
      type: err instanceof Error ? err.name : 'UpstreamError',
      message: `API unreachable: ${err instanceof Error ? err.message : String(err)}`,
      route: `${req.method} ${req.nextUrl.pathname}`,
      requestId,
    });
    res = NextResponse.json({ message: requestTranslator(req)('common.error.upstreamUnreachable') }, { status: 502 });
  }
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

export {
  handleWithRequestId as GET,
  handleWithRequestId as POST,
  handleWithRequestId as PUT,
  handleWithRequestId as PATCH,
  handleWithRequestId as DELETE,
};
