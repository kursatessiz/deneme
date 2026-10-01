import { NextRequest } from 'next/server';
import { resolveConsentRegion } from '@/lib/tracking/region';

/**
 * The visitor's consent region (docs/CRM_VE_ATIF.md) for cached public pages, which cannot read request
 * headers at render time: the browser asks once on load. Edge country header first (CF-IPCountry or
 * X-Country-Code), then Accept-Language, else the strictest behaviour. Never cached (it depends on the visitor).
 */
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest): Response {
  const region = resolveConsentRegion({
    countryHeader: request.headers.get('cf-ipcountry') ?? request.headers.get('x-country-code'),
    acceptLanguage: request.headers.get('accept-language'),
  });
  return Response.json(region, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Accept-Language, CF-IPCountry, X-Country-Code' } });
}
