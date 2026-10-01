import { createHash, timingSafeEqual } from 'node:crypto';
import { isSiteCacheTag } from '@platform/shared';

/**
 * Pure parts of POST /api/revalidate (app/api/revalidate/route.ts): the shared-secret comparison and the
 * tag allow-list. Only `site:<slug>` tags can be purged, so the endpoint cannot be used to evict arbitrary
 * cache entries even with the secret.
 */

/** Constant-time comparison of two secrets of any length (both are hashed to a fixed size first). */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** The purgeable tags of a request body `{ tags: string[] }`; null when the body is not that shape. */
export function parseRevalidateTags(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null || !('tags' in body)) return null;
  const tags = (body as { tags: unknown }).tags;
  if (!Array.isArray(tags) || tags.length === 0 || tags.length > 20) return null;
  if (!tags.every((t): t is string => typeof t === 'string')) return null;
  const allowed = tags.filter(isSiteCacheTag);
  return allowed.length > 0 ? Array.from(new Set(allowed)) : null;
}
