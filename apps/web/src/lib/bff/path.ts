/**
 * Turns the `[...path]` segments of the BFF catch-all route into a safe API
 * path. Never lets the browser choose an arbitrary host or escape the API's
 * path space: every segment must be a plain path component, `..` is
 * rejected outright, and the result is always relative (no scheme, no host).
 */
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;

export function sanitizeApiPath(segments: readonly string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null;
  for (const raw of segments) {
    if (!raw) return null;
    // Reject anything that could change the request's target path:
    // traversal, an encoded slash, or a segment that is not a plain token.
    if (raw === '.' || raw === '..') return null;
    if (raw.includes('/') || raw.includes('\\')) return null;
    if (!SAFE_SEGMENT.test(raw)) return null;
  }
  return segments.join('/');
}
