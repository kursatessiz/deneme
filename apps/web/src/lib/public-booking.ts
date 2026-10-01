import { publicApiBaseUrl } from '@/lib/public-api-url';

/**
 * Client for the unauthenticated, read-only public embed endpoints
 * (`/public/studios/:slug/embed/*`, apps/api embed-public.controller.ts).
 * Shared by the embeddable widget (`/embed/[studioSlug]`) and the public
 * booking page (`/booking/[studioSlug]/book`). Neither can create a
 * booking: booking needs a signed-in member, so both hand off to the member
 * app (deep link) or to the public lead form (docs/PUBLIC_API.md).
 */

/** Expo scheme, see apps/mobile/app.json "scheme". */
export const MOBILE_APP_SCHEME = 'platform';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EmbedConfig {
  name: string;
  logoUrl: string | null;
  themeFamily: string;
  themePrimary: string;
  gradientPresetKey: string;
}

export interface EmbedBranch {
  id: string;
  name: string;
}

export interface EmbedServiceType {
  id: string;
  name: string;
  durationMin: number;
}

export interface EmbedScheduleItem {
  id: string;
  branchId: string | null;
  serviceTypeId: string;
  title: string;
  startTime: string;
  endTime: string;
  capacity: number;
  bookedCount: number;
}

/** Thrown for a non-2xx answer; `message` is the API's own text when it sent one, otherwise empty. */
export class EmbedApiError extends Error {}

export async function embedFetch<T>(slug: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${publicApiBaseUrl()}/public/studios/${encodeURIComponent(slug)}/embed/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: unknown };
    throw new EmbedApiError(typeof body.message === 'string' ? body.message : '');
  }
  return res.json() as Promise<T>;
}

/** Opens the member app's own session screen (apps/mobile app/(app)/seans/[scheduleId].tsx). Only a well-formed id is ever put in the link. */
export function openMemberAppSession(scheduleId: string): void {
  if (!scheduleId || !UUID_PATTERN.test(scheduleId)) return;
  window.location.href = `${MOBILE_APP_SCHEME}://seans/${encodeURIComponent(scheduleId)}`;
}
