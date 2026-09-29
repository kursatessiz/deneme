import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { SOURCEMAP_TOKEN_HEADER } from '@platform/shared';

/**
 * The upload token of POST /admin/errors/sourcemaps: the dedicated
 * SOURCEMAP_UPLOAD_TOKEN, sent as `x-sourcemap-token` or as a bearer token.
 * False when no token is configured (uploads are then disabled) or the
 * presented one differs. Compared in constant time.
 */
export function sourcemapTokenValid(req: Pick<Request, 'headers'>, expected: string | undefined): boolean {
  if (!expected) return false;
  const direct = req.headers[SOURCEMAP_TOKEN_HEADER];
  const auth = req.headers.authorization;
  const presented = typeof direct === 'string' ? direct : typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
