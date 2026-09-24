import { NextRequest, NextResponse } from 'next/server';
import { apiInternalBaseUrl } from '@/lib/server-env';
import { sanitizeApiPath } from '@/lib/bff/path';
import { hasValidCsrfHeader, isSameOriginRequest, methodNeedsCsrfCheck } from '@/lib/bff/csrf';
import { stripHopByHopHeaders } from '@/lib/bff/headers';
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
): Promise<Response> {
  const url = new URL(`${apiInternalBaseUrl()}/${apiPath}${req.nextUrl.search}`);
  const headers = stripHopByHopHeaders(req.headers);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const studioId = req.headers.get('x-studio-id') ?? req.cookies.get(ACTIVE_STUDIO_COOKIE)?.value;
  if (studioId) headers.set('x-studio-id', studioId);

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const body = hasBody ? await req.arrayBuffer() : undefined;
  if (hasBody && body && body.byteLength > 0) {
    headers.set('content-type', headers.get('content-type') ?? 'application/json');
  }

  return fetch(url, {
    method: req.method,
    headers,
    body: hasBody && body && body.byteLength > 0 ? body : undefined,
    redirect: 'manual',
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
  const contentType = apiRes.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const buf = await apiRes.arrayBuffer();
    const res = new NextResponse(buf, { status: apiRes.status });
    const headers = stripHopByHopHeaders(apiRes.headers);
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

  // auth/login, auth/otp/verify, auth/pin/login: the body carries tokens
  // that must become cookies and never reach the browser as JSON.
  if (isTokenIssuingPath(apiPath) && req.method === 'POST') {
    const apiRes = await forward(req, apiPath, null);
    if (!apiRes.ok) return (await toNextResponse(apiRes)).res as NextResponse;
    const { body, res } = await toNextResponse(apiRes, ['accessToken', 'refreshToken']);
    const tokens = body as Partial<TokenPair> | null;
    if (tokens?.accessToken && tokens.refreshToken) {
      setSessionCookies(res, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    }
    return res;
  }

  if (isLogoutPath(apiPath) && req.method === 'POST') {
    if (accessToken) await forward(req, apiPath, accessToken).catch(() => undefined);
    const res = NextResponse.json({}, { status: 204 });
    clearSessionCookies(res);
    return res;
  }

  let apiRes = await forward(req, apiPath, accessToken);

  if (apiRes.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed) {
      apiRes = await forward(req, apiPath, refreshed.accessToken);
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
