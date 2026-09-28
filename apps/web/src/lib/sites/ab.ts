import { cookies, headers } from 'next/headers';
import { VISITOR_COOKIE, SESSION_COOKIE, assignVariant, fallbackStickyId } from '@platform/shared';

/**
 * Server-side A/B variant assignment for one page render
 * (docs/SAYFA_MOTORU.md). Sticky per visitor through the existing pw_vid
 * cookie (only ever written by the client tracker once analytics consent is
 * given); without it, falls back to a value derived from request signals
 * that are never stored, just hashed for this one decision, so the choice
 * still holds for repeat requests within the same day.
 */
export async function pickPageVariant(variantKeys: readonly string[]): Promise<{ variant: string; stickyId: string }> {
  if (variantKeys.length <= 1) return { variant: variantKeys[0] ?? 'control', stickyId: '' };

  const jar = await cookies();
  const h = await headers();
  const sticky = jar.get(VISITOR_COOKIE)?.value ?? jar.get(SESSION_COOKIE)?.value;
  const stickyId =
    sticky ?? fallbackStickyId(h.get('user-agent') ?? '', h.get('accept-language') ?? '', new Date().toISOString().slice(0, 10));
  return { variant: assignVariant(variantKeys, stickyId), stickyId };
}
