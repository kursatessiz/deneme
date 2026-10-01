/**
 * URL helpers of the public event pages (docs/ETKINLIKLER.md). An event has no slug column: its URL
 * segment is `<slugified title>-<id>` (or just the id), and only the trailing id is ever used to look it up,
 * so a renamed event keeps working and the title part is cosmetic.
 */

const UUID_TAIL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const MAX_SLUG_LENGTH = 60;

/** `Hafta sonu atölyesi` -> `hafta-sonu-atolyesi`; empty when the title has no latin letters or digits. */
export function slugifyTitle(title: string): string {
  const folded = title
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return folded.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
}

/** The `[eventSlugOrId]` segment of an event. */
export function eventSegment(event: { id: string; title: string }): string {
  const slug = slugifyTitle(event.title);
  return slug ? `${slug}-${event.id}` : event.id;
}

/** The event id inside a `[eventSlugOrId]` segment, or null when it carries none. */
export function parseEventSegment(segment: string): string | null {
  const match = UUID_TAIL.exec(segment);
  if (!match) return null;
  const prefix = segment.slice(0, match.index);
  if (prefix !== '' && !/^[a-z0-9-]*-$/i.test(prefix)) return null;
  return match[1].toLowerCase();
}

/**
 * Path of a tenant's public events on a given host. A tenant site host (`<slug>.<domain>` or a verified custom
 * domain) serves them at `/events`; the platform host serves every studio at `/events/<studioSlug>`.
 */
export function eventsListPath(studioSlug: string, onTenantHost: boolean): string {
  return onTenantHost ? '/events' : `/events/${studioSlug}`;
}

export function eventDetailPath(studioSlug: string, onTenantHost: boolean, event: { id: string; title: string }): string {
  return `${eventsListPath(studioSlug, onTenantHost)}/${eventSegment(event)}`;
}
