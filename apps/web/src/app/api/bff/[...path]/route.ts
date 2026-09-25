import { NextRequest, NextResponse } from 'next/server';
import { apiInternalBaseUrl } from '@/lib/server-env';
import { sanitizeApiPath } from '@/lib/bff/path';
import { hasValidCsrfHeader, isSameOriginRequest, methodNeedsCsrfCheck } from '@/lib/bff/csrf';
import { stripHopByHopHeaders } from '@/lib/bff/headers';
import { buildPassthroughResponseInit, isJsonResponse } from '@/lib/bff/proxy-response';
import {
  ACCESS_TOKEN_COOKIE,
  ACTIVE_STUDIO_COOKIE,
  REFRESH_TOKEN_COOKIE,
  accessTokenCookieOptions,
  expiredCookieOptions,
  refreshTokenCookieOptions,
} from '@/lib/bff/cookies';
import { isLogoutPath, isTokenIssuingPath } from '@/lib/bff/auth-paths';

/**
 * Backend-for-frontend proxy. Every `/api/bff/<path>` call from the browser
 * lands here and is forwarded to the API at a fixed, server-only base URL
 * (`API_INTERNAL_URL`) -- never to a host the client controls. See
 * docs/WEB_PANEL.md for the full design.
 */

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

async function forward(
  req: NextRequest,
  apiPath: string,
  accessToken: string | null,
  body: ArrayBuffer | undefined,
): Promise<Response> {
  const url = new URL(`${apiInternalBaseUrl()}/${apiPath}${req.nextUrl.search}`);
  const headers = stripHopByHopHeaders(req.headers);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

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

async function toNextResponse(apiRes: Response, dropKeys: readonly string[] = []): Promise<{ body: unknown; res: NextResponse }> {
  if (!isJsonResponse(apiRes)) {
    const buf = await apiRes.arrayBuffer();
    const { status, headers } = buildPassthroughResponseInit(apiRes);
    const res = new NextResponse(buf, { status });
    headers.forEach((value, key) => res.headers.set(key, value));
    return { body: null, res };
  }
  const json = (await apiRes.json().catch(() => null)) as Record<string, unknown> | null;
  const filtered = json && dropKeys.length > 0 ? Object.fromEntries(Object.entries(json).filter(([k]) => !dropKeys.includes(k))) : json;
  const res = NextResponse.json(filtered, { status: apiRes.status });
  return { body: filtered, res };
}

async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await context.params;
  const apiPath = sanitizeApiPath(path);
  if (!apiPath) {
    return NextResponse.json({ message: 'Geçersiz istek yolu' }, { status: 400 });
  }

  if (methodNeedsCsrfCheck(req.method)) {
    const originOk = isSameOriginRequest(req.headers.get('origin'), req.headers.get('host'));
    if (!originOk || !hasValidCsrfHeader(req.headers)) {
      return NextResponse.json({ message: 'Geçersiz istek kaynağı' }, { status: 403 });
    }
  }

  const accessToken = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
  const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value ?? null;
  // Read the body once: a refresh-and-retry must replay the same bytes.
  const requestBody = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();

  // auth/login, auth/otp/verify, auth/pin/login: the body carries tokens
  // that must become cookies and never reach the browser as JSON.
  if (isTokenIssuingPath(apiPath) && req.method === 'POST') {
    const apiRes = await forward(req, apiPath, null, requestBody);
    if (!apiRes.ok) return (await toNextResponse(apiRes)).res as NextResponse;
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
    if (accessToken) await forward(req, apiPath, accessToken, requestBody).catch(() => undefined);
    const res = new NextResponse(null, { status: 204 });
    clearSessionCookies(res);
    return res;
  }

  let apiRes = await forward(req, apiPath, accessToken, requestBody);

  if (apiRes.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed) {
      apiRes = await forward(req, apiPath, refreshed.accessToken, requestBody);
      const { res } = await toNextResponse(apiRes);
      setSessionCookies(res, refreshed);
      return res;
    }
    const { res } = await toNextResponse(apiRes);
    clearSessionCookies(res);
    return res;
  }

  const { res } = await toNextResponse(apiRes);
  return res;
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
