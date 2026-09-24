import { CreateWebhookEndpointSchema, EMBED_ORIGIN_PATTERN, GoogleReviewUrlSchema } from '@platform/shared';

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

/**
 * Client-side webhook URL check, reusing the exact schema the API validates
 * with (`CreateWebhookEndpointSchema.shape.url`) so the form's error message
 * never drifts from what the server will actually reject.
 */
export function validateWebhookUrl(value: string): ValidationResult {
  const result = CreateWebhookEndpointSchema.shape.url.safeParse(value);
  return result.success ? { valid: true, error: null } : { valid: false, error: result.error.issues[0]?.message ?? 'Geçersiz adres' };
}

/** Client-side embed allowed-origin check (https scheme + host only, no path). */
export function validateEmbedOrigin(value: string): ValidationResult {
  if (!EMBED_ORIGIN_PATTERN.test(value)) {
    return { valid: false, error: 'Geçersiz origin (ör. https://ornek.com)' };
  }
  return { valid: true, error: null };
}

/** Client-side Google review link check (CLAUDE.md: only g.page/search.google.com/local/writereview/maps https links). */
export function validateGoogleReviewUrl(value: string): ValidationResult {
  const result = GoogleReviewUrlSchema.safeParse(value);
  return result.success ? { valid: true, error: null } : { valid: false, error: result.error.issues[0]?.message ?? 'Geçersiz bağlantı' };
}
