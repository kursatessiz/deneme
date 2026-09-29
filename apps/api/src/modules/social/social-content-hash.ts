import { createHash } from 'crypto';
import { canonicalJson } from '../growth/campaigns/approval/content-hash';

/**
 * What an approval of a social post is bound to (docs/PAZARLAMA_MODULU.md
 * 6.1): the account, the text, the media, the link and the publish time.
 * The language, the brand check result and the notes may change without
 * invalidating the approval; anything here may not.
 */
export interface SocialPostContentInput {
  connectionId: string;
  text: string;
  mediaUrls: readonly string[];
  link: string | null;
  /** ISO time of the publish; null while unscheduled. */
  scheduledAt: string | null;
}

export function socialPostContentHash(input: SocialPostContentInput): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        v: 1,
        connectionId: input.connectionId,
        text: input.text,
        mediaUrls: [...input.mediaUrls],
        link: input.link ?? null,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null,
      }),
    )
    .digest('hex');
}

/** Media URLs as stored in the JSON column, tolerant of anything unexpected. */
export function mediaUrlsOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}
