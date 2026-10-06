import { requestTranslator } from '@/lib/bff/request-translator';
import { NextRequest, NextResponse } from 'next/server';
import { ERROR_LIMITS, REQUEST_ID_HEADER } from '@platform/shared';
import { apiInternalBaseUrl } from '@/lib/server-env';
import { hasValidCsrfHeader, isSameOriginRequest } from '@/lib/bff/csrf';
import { requestIdFrom } from '@/lib/errors/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Anonymous feedback note for an error event of a public page (H3): POST
 * only, same-origin with the BFF CSRF header, size limited, forwarded to the
 * API's POST /telemetry/errors/:eventId/feedback without any credential. The
 * API rate limits, scrubs and decides whether the event accepts a note.
 * Signed-in pages use the BFF instead.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const t = requestTranslator(req);
  if (!isSameOriginRequest(req.headers.get('origin'), req.headers.get('host')) || !hasValidCsrfHeader(req.headers)) {
    return NextResponse.json({ message: t('common.error.invalidRequestOrigin') }, { status: 403 });
  }
  const { eventId } = await ctx.params;
  if (!UUID.test(eventId)) return NextResponse.json({ message: t('common.error.invalidRequest') }, { status: 400 });
  const body = await req.arrayBuffer();
  if (body.byteLength > ERROR_LIMITS.batchBytes) {
    return NextResponse.json({ message: t('common.error.requestTooLarge') }, { status: 413 });
  }
  const requestId = requestIdFrom(req.headers);
  const headers: Record<string, string> = { 'content-type': 'application/json', [REQUEST_ID_HEADER]: requestId };
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
  try {
    const apiRes = await fetch(`${apiInternalBaseUrl()}/telemetry/errors/${eventId}/feedback`, {
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
    return NextResponse.json({ message: t('common.error.feedbackFailed') }, { status: 502 });
  }
}
