import { z } from 'zod';
import { vmsg } from './validation-key';

/**
 * Source map upload contract (H2, docs/HATA_RAPORLAMA.md). CI and the mobile
 * upload script send minified-bundle source maps to the API keyed by release
 * and platform; the API resolves minified stack frames of client error
 * events with them. Pure TypeScript: the same path normalisation runs in the
 * upload scripts and in the API, so a stored path and a stack frame URL
 * always meet in the same form.
 */

export const SOURCEMAP_PLATFORMS = ['web', 'mobile'] as const;
export type SourcemapPlatform = (typeof SOURCEMAP_PLATFORMS)[number];

export const SOURCEMAP_LIMITS = {
  /** Largest single map (raw JSON text), in bytes. */
  fileBytes: 10 * 1024 * 1024,
  /** Request body limit of POST /admin/errors/sourcemaps (JSON string escaping can inflate a map). */
  bodyBytes: 24 * 1024 * 1024,
  /** Maps stored per release and platform. */
  filesPerRelease: 2000,
  /** Days a map is kept (the error heartbeat purges older ones). */
  retentionDays: 30,
  pathLength: 300,
  releaseLength: 64,
} as const;

/** Header carrying the upload token (Authorization: Bearer is accepted too). */
export const SOURCEMAP_TOKEN_HEADER = 'x-sourcemap-token';

const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isValidSourcemapRelease(value: unknown): value is string {
  return typeof value === 'string' && RELEASE_PATTERN.test(value);
}

/**
 * Release of a mobile build: the app version, plus the EAS Update id when
 * the running JS bundle came from an update (the maps of an update differ
 * from the embedded bundle's). Falls back to the plain version when the
 * combination would not be a valid release.
 */
export function mobileRelease(version: string | null | undefined, updateId?: string | null): string {
  const v = (version ?? '').trim() || 'unknown';
  const u = (updateId ?? '').trim();
  const combined = u ? `${v}-${u}` : v;
  return isValidSourcemapRelease(combined) ? combined : isValidSourcemapRelease(v) ? v : 'unknown';
}

/**
 * Normalises a bundle path or a stack frame URL to the form maps are stored
 * under: no scheme or origin, no query or fragment, no leading slash or "./".
 * Null when empty, too long, containing "..", backslashes or control chars.
 */
export function normalizeSourcemapPath(input: string): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2000) return null;
  let value = input;
  const hash = value.indexOf('#');
  if (hash !== -1) value = value.slice(0, hash);
  const query = value.indexOf('?');
  if (query !== -1) value = value.slice(0, query);
  // scheme://host, single left-to-right scan (no regex on untrusted input).
  const schemeEnd = value.indexOf('://');
  if (schemeEnd > 0 && schemeEnd <= 24) {
    const slash = value.indexOf('/', schemeEnd + 3);
    value = slash === -1 ? '' : value.slice(slash);
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || value[i] === '\\') return null;
  }
  while (value.startsWith('/') || value.startsWith('./')) value = value.startsWith('/') ? value.slice(1) : value.slice(2);
  if (!value || value.length > SOURCEMAP_LIMITS.pathLength) return null;
  for (const segment of value.split('/')) if (segment === '..' || segment === '') return null;
  return value;
}

/**
 * Candidate stored paths for a frame URL, longest first: the full path,
 * then the path without its first segment, and so on (the frame of a device
 * often carries an absolute file path while the map was uploaded under the
 * bundle's file name; at most `max` suffixes, the shortest ending in the file name). Frame URLs are untrusted: they are only lookup keys.
 */
export function sourcemapPathCandidates(frameUrl: string, max = 8): string[] {
  if (typeof frameUrl !== 'string' || frameUrl.length === 0 || frameUrl.length > 2000) return [];
  let value = frameUrl;
  const cut = value.search(/[?#]/);
  if (cut !== -1) value = value.slice(0, cut);
  const schemeEnd = value.indexOf('://');
  if (schemeEnd > 0 && schemeEnd <= 24) {
    const slash = value.indexOf('/', schemeEnd + 3);
    value = slash === -1 ? '' : value.slice(slash);
  }
  // Browsers percent-encode route groups such as (dashboard); maps are stored under the literal name.
  const segments = value
    .split('/')
    .filter((p) => p !== '' && p !== '.' && p !== '..')
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  const out: string[] = [];
  // Deep absolute paths keep their tail: the file name is always a candidate.
  for (let i = Math.max(0, segments.length - max); i < segments.length; i++) {
    const candidate = segments.slice(i).join('/');
    if (candidate.length <= SOURCEMAP_LIMITS.pathLength) out.push(candidate);
  }
  return out;
}

export const SourcemapUploadSchema = z
  .object({
    release: z.string().refine(isValidSourcemapRelease, vmsg('validation.invalidVersion')),
    platform: z.enum(SOURCEMAP_PLATFORMS),
    /** Bundle path as the client reports it in stack frames (e.g. _next/static/chunks/app-1a2b.js). */
    path: z.string().min(1).max(SOURCEMAP_LIMITS.pathLength * 2),
    /** The source map v3 JSON, as text or as an object. */
    map: z.union([z.string().min(2), z.record(z.unknown())]),
  })
  .strict();
export type SourcemapUpload = z.infer<typeof SourcemapUploadSchema>;

export interface SourcemapUploadResult {
  release: string;
  platform: SourcemapPlatform;
  path: string;
  bytes: number;
  /** True when a map for this release and path already existed and was replaced. */
  replaced: boolean;
}
