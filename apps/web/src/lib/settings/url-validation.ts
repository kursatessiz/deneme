import { CreateWebhookEndpointSchema, EMBED_ORIGIN_PATTERN, GoogleReviewUrlSchema } from '@platform/shared';
import { validationMessageOf } from '@/lib/i18n/client-translator';

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

/**
 * Client-side webhook URL check, reusing the exact schema the API validates
 * with (`CreateWebhookEndpointSchema.shape.url`) so the form's error message
 * never drifts from what the server will actually reject.
 * `messages`: the active translator's fallback strings, since this is a plain lib function without hook access.
 */
export function validateWebhookUrl(value: string, messages: { invalidAddress: string }): ValidationResult {
  const result = CreateWebhookEndpointSchema.shape.url.safeParse(value);
  return result.success ? { valid: true, error: null } : { valid: false, error: validationMessageOf(result.error.issues[0]?.message, messages.invalidAddress) };
}

/** Client-side embed allowed-origin check (https scheme + host only, no path). */
export function validateEmbedOrigin(value: string, messages: { invalidOrigin: string }): ValidationResult {
  if (!EMBED_ORIGIN_PATTERN.test(value)) {
    return { valid: false, error: messages.invalidOrigin };
  }
  return { valid: true, error: null };
}

/** Client-side Google review link check (CLAUDE.md: only g.page/search.google.com/local/writereview/maps https links). */
export function validateGoogleReviewUrl(value: string, messages: { invalidLink: string }): ValidationResult {
  const result = GoogleReviewUrlSchema.safeParse(value);
  return result.success ? { valid: true, error: null } : { valid: false, error: validationMessageOf(result.error.issues[0]?.message, messages.invalidLink) };
}
