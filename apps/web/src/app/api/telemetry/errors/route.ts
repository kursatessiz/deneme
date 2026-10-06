import { requestTranslator } from '@/lib/bff/request-translator';
import { NextRequest, NextResponse } from 'next/server';
import { ERROR_LIMITS, REQUEST_ID_HEADER } from '@platform/shared';
import { apiInternalBaseUrl } from '@/lib/server-env';
import { hasValidCsrfHeader, isSameOriginRequest } from '@/lib/bff/csrf';
import { requestIdFrom } from '@/lib/errors/server';

/**
 * Minimal, anonymous error ingest for public pages (booking, platform and
 * tenant sites) that have no session: POST only, same-origin with the BFF
 * CSRF header, size limited, forwarded to the API's POST /telemetry/errors
 * without any credential. Signed-in pages use the BFF instead
 * (/api/bff/telemetry/errors). The API rate limits, samples and scrubs.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const t = requestTranslator(req);
  if (!isSameOriginRequest(req.headers.get('origin'), req.headers.get('host')) || !hasValidCsrfHeader(req.headers)) {
    return NextResponse.json({ message: t('common.error.invalidRequestOrigin') }, { status: 403 });
  }
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > ERROR_LIMITS.batchBytes) {
    return NextResponse.json({ message: t('common.error.requestTooLarge') }, { status: 413 });
  }
  const body = await req.arrayBuffer();
  if (body.byteLength > ERROR_LIMITS.batchBytes) {
    return NextResponse.json({ message: t('common.error.requestTooLarge') }, { status: 413 });
  }

  const requestId = requestIdFrom(req.headers);
  const headers: Record<string, string> = { 'content-type': 'application/json', [REQUEST_ID_HEADER]: requestId };
  // Caddy's client address, so the API's per-IP limit applies per visitor.
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;

  try {
    const apiRes = await fetch(`${apiInternalBaseUrl()}/telemetry/errors`, {
      method: 'POST',
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const res = NextResponse.json((await apiRes.json().catch(() => null)) ?? {}, { status: apiRes.status });
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  } catch {
    return NextResponse.json({ message: t('common.error.errorReportFailed') }, { status: 502 });
  }
}
