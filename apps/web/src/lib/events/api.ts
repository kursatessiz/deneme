import { headers } from 'next/headers';
import { STUDIO_SLUG_PATTERN } from '@platform/shared';
import type { PublicEventDTO } from '@platform/shared';
import { apiInternalBaseUrl } from '@/lib/server-env';
import type { EmbedConfig } from '@/lib/public-booking';
import { studioSlugForHost } from '@/lib/sites/api';
import { requestSiteOrigin } from '@/lib/sites/request-origin';
import { eventsListPath } from './paths';

/**
 * Server-only reads of the public event pages: the studio's public config (name, logo, brand, time zone) and
 * its PUBLIC and PUBLISHED events, both unauthenticated API endpoints resolved by studio slug and cached like
 * the page engine reads. Always the internal API URL, never a client-controlled host.
 */

const REVALIDATE_SECONDS = 300;

/** Studio branding and zone; null for an unknown studio or an unreachable API. */
export async function fetchPublicStudio(slug: string): Promise<EmbedConfig | null> {
  if (!STUDIO_SLUG_PATTERN.test(slug)) return null;
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/public/studios/${encodeURIComponent(slug)}/embed/config`, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as EmbedConfig;
  } catch {
    return null;
  }
}

/** The studio's public, published, unfinished events (the API caps the list at 100). Empty when unknown or unreachable. */
export async function fetchPublicEvents(slug: string): Promise<PublicEventDTO[]> {
  if (!STUDIO_SLUG_PATTERN.test(slug)) return [];
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/public/studios/${encodeURIComponent(slug)}/events`, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    return ((await res.json()) as { items: PublicEventDTO[] }).items;
  } catch {
    return [];
  }
}

/** One public event by id; null when it is not public, not published, over, or unknown. */
export async function fetchPublicEvent(slug: string, eventId: string): Promise<PublicEventDTO | null> {
  if (!STUDIO_SLUG_PATTERN.test(slug)) return null;
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/public/studios/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicEventDTO;
  } catch {
    return null;
  }
}

export interface EventsHost {
  /** True when the request host is the studio's own site host, where the pages live at `/events`. */
  onTenantHost: boolean;
  /** Origin of the canonical URLs: the studio's site origin (custom domain when verified, else `<slug>.<base domain>`). */
  origin: string;
  /** Path of the events list on the canonical origin. */
  canonicalListPath: string;
}

/**
 * Host context of a public event page. The canonical URL is always on the studio's site origin and sits at
 * `/events` there (the platform tenant itself keeps `/events/<slug>`), so the platform-host URL and the tenant
 * host URL of the same event are one page for search engines; the tenant sitemap lists the latter.
 */
export async function eventsHost(studioSlug: string): Promise<EventsHost> {
  const isPlatform = studioSlug === 'platform';
  const site = await studioSlugForHost((await headers()).get('host') ?? '');
  const onTenantHost = !site.isPlatform && site.studioSlug === studioSlug;
  const origin = await requestSiteOrigin(studioSlug, isPlatform);
  return { onTenantHost, origin, canonicalListPath: eventsListPath(studioSlug, !isPlatform) };
}
