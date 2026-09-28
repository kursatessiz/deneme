import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { LANGUAGE_PACK_MAX_BYTES } from '@platform/shared';

/** Default request body limit for every route except the ones listed below. */
export const DEFAULT_BODY_LIMIT = '100kb';

/**
 * Registers the body parsers explicitly. The app must be created with
 * `bodyParser: false`: Nest skips its own parsers whenever a middleware named
 * `jsonParser` is already on the stack, even one mounted on a single path,
 * which would leave every other route without a parsed body.
 *
 * POST admin/i18n/languages/:code/import carries a whole language pack, so
 * that path alone gets a larger limit. The path-scoped parser runs first and
 * marks the body as parsed; the default parser then skips it.
 */
export function configureBodyParsers(app: NestExpressApplication): void {
  app.use('/admin/i18n/languages', json({ limit: LANGUAGE_PACK_MAX_BYTES + 64 * 1024 }));
  app.use(json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));
}
