/**
 * The protected-path list lives in `@platform/shared` (sites/indexing.ts) so
 * robots.txt, the middleware's X-Robots-Tag and the session check share one
 * source. Re-exported here for the existing web imports.
 */
export { PROTECTED_PATHS, isProtectedPath } from '@platform/shared';
