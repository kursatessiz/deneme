/**
 * A/B variant assignment for page-engine blocks. Deterministic (same
 * sticky id always yields the same variant) so a visitor's assignment is
 * stable for as long as the sticky id (pw_vid when consent allows it,
 * otherwise a per-request fallback id) stays the same. See
 * docs/SAYFA_MOTORU.md and docs/BUYUME_VE_GLOBAL_MIMARI.md section 3.9.
 */

/** FNV-1a, tiny and dependency-free; only used to spread ids across buckets, not for security. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Picks a variant key deterministically from a sticky id. `variantKeys`
 * must be sorted the same way on every call (callers pass the distinct
 * variant keys found on a page's blocks, sorted).
 */
export function assignVariant(variantKeys: readonly string[], stickyId: string): string {
  if (variantKeys.length === 0) return 'control';
  if (variantKeys.length === 1) return variantKeys[0];
  const index = fnv1a(stickyId) % variantKeys.length;
  return variantKeys[index];
}

/**
 * Fallback sticky id for a visitor who has not consented to analytics yet
 * (so no pw_vid/pw_sid cookie exists). Built from request signals that are
 * never stored, only hashed in memory for this one assignment decision.
 */
export function fallbackStickyId(userAgent: string, acceptLanguage: string, dayBucket: string): string {
  return `${userAgent}|${acceptLanguage}|${dayBucket}`;
}
