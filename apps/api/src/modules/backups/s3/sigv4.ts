import { createHash, createHmac } from 'crypto';

/**
 * AWS Signature Version 4 for S3-compatible object storage, in-house so the
 * API does not take an S3 SDK dependency (docs/YEDEKLER.md). Covers what the
 * backup store needs: header-signed requests and presigned GET URLs.
 * Reference: AWS "Signature Version 4 signing process" and the S3
 * "Authenticating Requests (AWS Signature Version 4)" examples, which the
 * spec uses as test vectors.
 */

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

export interface SigV4Request {
  method: string;
  /** Host header value (host[:port]). */
  host: string;
  /** Already URI-encoded path, e.g. "/bucket/db/db_1.sql.gz.enc". */
  path: string;
  query?: Record<string, string>;
  /** Extra headers to sign (names are lower-cased). */
  headers?: Record<string, string>;
  /** Hex sha256 of the body, or "UNSIGNED-PAYLOAD". */
  payloadHash: string;
}

export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
export const EMPTY_PAYLOAD_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** RFC 3986 encoding as SigV4 requires: everything but A-Z a-z 0-9 - _ . ~ is percent-encoded. */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(ch) || (!encodeSlash && ch === '/')) out += ch;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** Encodes an object key for use in a path, keeping "/" separators. */
export function encodeKeyPath(key: string): string {
  return uriEncode(key, false);
}

/** "20130524T000000Z" */
export function amzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Sorted, RFC 3986 encoded query string; also used to build the request URL so both match. */
export function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .map((k) => [uriEncode(k), uriEncode(query[k])] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

function signingKey(secret: string, day: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

interface Canonical {
  canonicalRequest: string;
  signedHeaders: string;
}

function canonicalize(req: SigV4Request, headers: Record<string, string>, query: Record<string, string>): Canonical {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  const names = Object.keys(lower).sort();
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [req.method.toUpperCase(), req.path, canonicalQuery(query), canonicalHeaders, signedHeaders, req.payloadHash].join('\n');
  return { canonicalRequest, signedHeaders };
}

function stringToSign(date: Date, scope: string, canonicalRequest: string): string {
  return ['AWS4-HMAC-SHA256', amzDate(date), scope, sha256Hex(canonicalRequest)].join('\n');
}

/**
 * Returns the headers to send (host excluded: fetch sets it) including
 * Authorization, x-amz-date and x-amz-content-sha256.
 */
export function signRequest(req: SigV4Request, creds: SigV4Credentials, now: Date): Record<string, string> {
  const service = creds.service ?? 's3';
  const day = amzDate(now).slice(0, 8);
  const scope = `${day}/${creds.region}/${service}/aws4_request`;
  const headers: Record<string, string> = {
    ...(req.headers ?? {}),
    host: req.host,
    'x-amz-date': amzDate(now),
    'x-amz-content-sha256': req.payloadHash,
  };
  const { canonicalRequest, signedHeaders } = canonicalize(req, headers, req.query ?? {});
  const signature = createHmac('sha256', signingKey(creds.secretAccessKey, day, creds.region, service))
    .update(stringToSign(now, scope, canonicalRequest), 'utf8')
    .digest('hex');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() !== 'host') out[k] = v;
  out.authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}

/**
 * Presigned URL (query-string auth, UNSIGNED-PAYLOAD) valid for
 * `expiresSeconds`. Only the host header is signed.
 */
export function presignUrl(
  req: Omit<SigV4Request, 'payloadHash' | 'headers'> & { protocol: 'http:' | 'https:' },
  creds: SigV4Credentials,
  now: Date,
  expiresSeconds: number,
): string {
  const service = creds.service ?? 's3';
  const day = amzDate(now).slice(0, 8);
  const scope = `${day}/${creds.region}/${service}/aws4_request`;
  const query: Record<string, string> = {
    ...(req.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${creds.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate(now),
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const { canonicalRequest } = canonicalize({ ...req, payloadHash: UNSIGNED_PAYLOAD }, { host: req.host }, query);
  const signature = createHmac('sha256', signingKey(creds.secretAccessKey, day, creds.region, service))
    .update(stringToSign(now, scope, canonicalRequest), 'utf8')
    .digest('hex');
  return `${req.protocol}//${req.host}${req.path}?${canonicalQuery({ ...query, 'X-Amz-Signature': signature })}`;
}
