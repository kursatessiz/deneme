import { z } from 'zod';
import { vmsg } from './validation-key';

/**
 * Platform-wide error capture and reporting (H1, docs/HATA_RAPORLAMA.md).
 *
 * This file is the single contract between the clients (web now, mobile in
 * H2), the API ingest endpoint and the storage: the event and batch
 * schemas, the PII scrubber every side runs, the fingerprint that groups
 * events, the short user-facing error code and the request id format.
 *
 * Everything here is pure TypeScript without Node or browser APIs, so the
 * same code runs in the browser, in the Next.js server and in the API.
 * Every string scanner below is a single left-to-right pass (no regular
 * expression with nested or adjacent unbounded quantifiers is applied to
 * untrusted input), so the cost is linear in the input length.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ERROR_SOURCES = ['api', 'web', 'mobile', 'job'] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];
/** Sources a client may send to the ingest endpoint; api and job are server-side only. */
export const CLIENT_ERROR_SOURCES = ['web', 'mobile'] as const;

export const ERROR_SEVERITIES = ['fatal', 'error', 'warning'] as const;
export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];

export const ERROR_GROUP_STATUSES = ['OPEN', 'RESOLVED', 'IGNORED'] as const;
export type ErrorGroupStatus = (typeof ERROR_GROUP_STATUSES)[number];

export const BREADCRUMB_TYPES = ['navigation', 'click', 'request'] as const;
export type BreadcrumbType = (typeof BREADCRUMB_TYPES)[number];

export const ERROR_LIMITS = {
  typeLength: 120,
  messageLength: 1000,
  stackLength: 8000,
  routeLength: 300,
  breadcrumbs: 20,
  breadcrumbMessageLength: 200,
  breadcrumbDataKeys: 8,
  breadcrumbDataValueLength: 200,
  /** Events per ingest request. */
  batchItems: 20,
  /** Request body limit of POST /telemetry/errors, in bytes. */
  batchBytes: 64 * 1024,
  /** Stored events kept per group; older ones are trimmed on write. */
  eventsPerGroup: 50,
  /** Days an individual event is kept (the heartbeat purges older ones). */
  retentionDays: 30,
  titleLength: 200,
  noteLength: 2000,
} as const;

/** Header carrying the correlation id: web -> BFF -> API -> jobs, echoed in every response. */
export const REQUEST_ID_HEADER = 'x-request-id';
/** Response header with the short error code of a recorded 5xx (see errorCodeFromId). */
export const ERROR_CODE_HEADER = 'x-error-code';

/** Built-in email templates sent to super admins (docs/HATA_RAPORLAMA.md, "Uyarılar"). */
export const ERROR_ALERT_TEMPLATE_KEYS = {
  newGroup: 'ERROR_NEW_GROUP',
  regression: 'ERROR_REGRESSION',
  critical: 'ERROR_CRITICAL',
  digest: 'ERROR_DIGEST',
  /** H3: spike alert to super admins. */
  spike: 'ERROR_SPIKE',
  /** H3: opt-in notice to a tenant owner. */
  ownerNotice: 'ERROR_OWNER_NOTICE',
} as const;
export type ErrorAlertKind = 'NEW' | 'REGRESSION' | 'CRITICAL';

// ---------------------------------------------------------------------------
// Request id and error code
// ---------------------------------------------------------------------------

/** 16-64 characters of [A-Za-z0-9-]: a UUID fits, header injection does not. */
export function isValidRequestId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 16 || value.length > 64) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45;
    if (!ok) return false;
  }
  return true;
}

/**
 * The short, user-facing error code shown on error screens and searched by
 * super admins: the first 8 hex digits of the event id, upper case.
 */
export function errorCodeFromId(eventId: string): string {
  let out = '';
  for (let i = 0; i < eventId.length && out.length < 8; i++) {
    const c = eventId[i];
    if (isHexChar(c)) out += c;
  }
  return out.toUpperCase();
}

export function isErrorCode(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 8) return false;
  for (const c of value) if (!isHexChar(c)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ReleaseSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((v) => isPlainToken(v, '._-'), vmsg('validation.invalidVersion'));
const EnvironmentSchema = z
  .string()
  .min(1)
  .max(20)
  .refine((v) => isPlainToken(v, '_-'), vmsg('validation.invalidEnvironment'));

export const BreadcrumbSchema = z.object({
  type: z.enum(BREADCRUMB_TYPES),
  message: z.string().max(ERROR_LIMITS.breadcrumbMessageLength),
  at: z.string().datetime(),
  data: z
    .record(z.string().max(40), z.string().max(ERROR_LIMITS.breadcrumbDataValueLength))
    .refine((d) => Object.keys(d).length <= ERROR_LIMITS.breadcrumbDataKeys, vmsg('validation.tooManyFields'))
    .optional(),
});
export type Breadcrumb = z.infer<typeof BreadcrumbSchema>;

/**
 * One event as a client sends it. studioId and userIdHash are deliberately
 * absent: the API derives them from the authenticated context only, and
 * unknown keys (a spoofed studioId) are stripped by the parser.
 */
export const ClientErrorEventSchema = z.object({
  eventId: z.string().uuid(),
  source: z.enum(CLIENT_ERROR_SOURCES),
  severity: z.enum(ERROR_SEVERITIES).default('error'),
  release: ReleaseSchema,
  environment: EnvironmentSchema,
  /** Route pattern or screen name, never a full URL with a query string. */
  route: z.string().max(ERROR_LIMITS.routeLength).optional(),
  requestId: z.string().refine(isValidRequestId, vmsg('validation.invalidRequestId')).optional(),
  type: z.string().min(1).max(ERROR_LIMITS.typeLength),
  message: z.string().max(ERROR_LIMITS.messageLength),
  stack: z.string().max(ERROR_LIMITS.stackLength).optional(),
  breadcrumbs: z.array(BreadcrumbSchema).max(ERROR_LIMITS.breadcrumbs).optional(),
  timestamp: z.string().datetime(),
  /** Random per browser tab session; only used for the per-session rate limit. */
  sessionId: z.string().refine(isValidRequestId, vmsg('validation.invalidSessionId')).optional(),
});
export type ClientErrorEvent = z.infer<typeof ClientErrorEventSchema>;

export const ErrorBatchSchema = z.object({
  events: z.array(ClientErrorEventSchema).min(1).max(ERROR_LIMITS.batchItems),
});
export type ErrorBatch = z.infer<typeof ErrorBatchSchema>;

/** A normalised event as the API stores it, after scrubbing and context resolution. */
export interface ErrorEventRecord {
  eventId: string;
  source: ErrorSource;
  severity: ErrorSeverity;
  release: string;
  environment: string;
  route: string | null;
  requestId: string | null;
  /** Only from the authenticated context or the server itself, never from a client body. */
  studioId: string | null;
  /** sha256(salt + userId), never the raw id. */
  userIdHash: string | null;
  type: string;
  message: string;
  stack: string | null;
  breadcrumbs: Breadcrumb[];
  statusCode: number | null;
  occurredAt: Date;
}

// Admin and tenant views ------------------------------------------------------

export const ErrorGroupListQuerySchema = z.object({
  source: z.enum(ERROR_SOURCES).optional(),
  status: z.enum(ERROR_GROUP_STATUSES).optional(),
  release: z.string().max(64).optional(),
  studioId: z.string().uuid().optional(),
  /** An 8-character error code, or text matched against the title. */
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type ErrorGroupListQuery = z.infer<typeof ErrorGroupListQuerySchema>;

export const ErrorGroupNoteSchema = z.object({ note: z.string().trim().max(ERROR_LIMITS.noteLength) }).strict();
export const ErrorGroupResolveSchema = z
  .object({
    /** Release that contains the fix; defaults to the API's own release. */
    release: ReleaseSchema.optional(),
  })
  .strict();

export interface ErrorGroupSummaryDTO {
  id: string;
  source: ErrorSource;
  title: string;
  type: string;
  status: ErrorGroupStatus;
  count: number;
  affectedStudioCount: number;
  affectedUserCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastRelease: string | null;
  resolvedInRelease: string | null;
  lastCode: string | null;
  critical: boolean;
}

export interface ErrorEventDTO {
  id: string;
  code: string;
  source: ErrorSource;
  severity: ErrorSeverity;
  release: string;
  environment: string;
  route: string | null;
  requestId: string | null;
  studioId: string | null;
  studioName: string | null;
  userIdHash: string | null;
  type: string;
  message: string;
  stack: string | null;
  /** Stack with original file names and lines, when the release's source maps were known (H2). */
  symbolicatedStack: string | null;
  /** Source lines around the resolved frames, when the release's source maps carried sourcesContent (H3). */
  symbolicatedContext: ErrorSourceContextDTO[] | null;
  /** The user's optional "what were you doing" note, scrubbed (H3). */
  feedback: string | null;
  breadcrumbs: Breadcrumb[];
  statusCode: number | null;
  occurredAt: string;
}

export interface ErrorSourceContextDTO {
  location: string;
  startLine: number;
  lines: string[];
  focus: number;
}

export interface ErrorGroupDetailDTO extends ErrorGroupSummaryDTO {
  fingerprint: string;
  note: string | null;
  topFrame: string | null;
  releases: Array<{ release: string; count: number; lastSeenAt: string }>;
  studios: Array<{ studioId: string; studioName: string | null; count: number; lastSeenAt: string }>;
  events: ErrorEventDTO[];
  /** Set when this group was merged into another (H3); its events live in the target now. */
  mergedIntoId: string | null;
  /** Fingerprints merged into this group. */
  aliasCount: number;
  /** The latest alerts of this group. */
  alerts: ErrorAlertSummaryDTO[];
}

export interface ErrorAlertSummaryDTO {
  id: string;
  kind: 'SPIKE' | 'NEW_GROUP' | 'REGRESSION';
  windowCount: number;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface ErrorGroupListDTO {
  items: ErrorGroupSummaryDTO[];
  total: number;
  page: number;
  pageSize: number;
}

/** Tenant owner view: only the tenant's own occurrences, no stack or internals. */
export interface StudioErrorGroupDTO {
  id: string;
  source: ErrorSource;
  /** Scrubbed client message; null for api/job errors (shown as a generic server error). */
  safeMessage: string | null;
  status: ErrorGroupStatus;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastCode: string | null;
}

// ---------------------------------------------------------------------------
// Character helpers
// ---------------------------------------------------------------------------

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}
function isLower(c: string): boolean {
  return c >= 'a' && c <= 'z';
}
function isUpper(c: string): boolean {
  return c >= 'A' && c <= 'Z';
}
function isAlnum(c: string): boolean {
  return isDigit(c) || isLower(c) || isUpper(c);
}
function isHexChar(c: string): boolean {
  return isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}
function isPlainToken(value: string, extra: string): boolean {
  for (const c of value) if (!isAlnum(c) && !extra.includes(c)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// PII scrubber
// ---------------------------------------------------------------------------

export const SCRUB_MASKS = {
  email: '[email]',
  phone: '[phone]',
  card: '[card]',
  token: '[token]',
  secret: '[secret]',
  redacted: '[redacted]',
} as const;

/** Field names whose value is always masked (compared lower case, without _ or -). */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'pass',
  'passcode',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'apikey',
  'authorization',
  'auth',
  'cookie',
  'setcookie',
  'session',
  'sessionid',
  'pin',
  'otp',
  'cvv',
  'cvc',
  'iban',
  'cardnumber',
  'clientsecret',
  'privatekey',
  'signature',
]);
const SENSITIVE_SUFFIXES = ['password', 'secret', 'token', 'apikey'];

export function isSensitiveKey(key: string): boolean {
  let norm = '';
  for (const c of key) {
    if (c === '_' || c === '-' || c === '.' || c === ' ') continue;
    norm += c.toLowerCase();
    if (norm.length > 40) return false;
  }
  if (SENSITIVE_KEYS.has(norm)) return true;
  return SENSITIVE_SUFFIXES.some((s) => norm.endsWith(s));
}

/** Characters that may form a "word" for the token pass (emails, JWTs, secrets, paths). */
function isTokenChar(c: string): boolean {
  return isAlnum(c) || c === '.' || c === '_' || c === '%' || c === '+' || c === '-' || c === '@' || c === '/' || c === '~';
}
function isEmailLocalChar(c: string): boolean {
  return isAlnum(c) || c === '.' || c === '_' || c === '%' || c === '+' || c === '-';
}
function isEmailDomainChar(c: string): boolean {
  return isAlnum(c) || c === '.' || c === '-';
}
function isBase64Char(c: string): boolean {
  return isAlnum(c) || c === '+' || c === '/' || c === '_' || c === '-';
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** "2026-09-29..." at `at`: a date, not a phone number. Reads at most 10 characters. */
function looksLikeIsoDate(input: string, at: number): boolean {
  if (at + 10 > input.length) return false;
  for (let k = 0; k < 10; k++) {
    const c = input[at + k];
    if (k === 4 || k === 7 ? c !== '-' : !isDigit(c)) return false;
  }
  return true;
}

/**
 * Pass 1: runs of digits with phone-like separators (space, dash,
 * parentheses, a leading plus). Card numbers (13-19 digits, Luhn) become
 * [card]; runs with 10-15 digits, or 7+ digits after a plus, become [phone].
 * Each character is visited a bounded number of times.
 */
function scrubDigitRuns(input: string): string {
  const out: string[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    const prev = i > 0 ? input[i - 1] : '';
    const startsRun = (isDigit(c) || ((c === '+' || c === '(') && i + 1 < n && isDigit(input[i + 1]))) && !isAlnum(prev);
    if (!startsRun) {
      out.push(c);
      i++;
      continue;
    }
    let j = i;
    let digits = '';
    let lastDigitEnd = i;
    while (j < n) {
      const d = input[j];
      if (isDigit(d)) {
        digits += d;
        j++;
        lastDigitEnd = j;
        if (digits.length > 19) break;
      } else if ((d === ' ' || d === '-' || d === '(' || d === ')' || (d === '+' && j === i)) && j + 1 < n) {
        j++;
      } else {
        break;
      }
    }
    // Continue past a run that is longer than any phone or card number
    // (an id, a timestamp) without re-scanning it.
    if (digits.length > 19) {
      while (j < n && isDigit(input[j])) j++;
      out.push(input.slice(i, j));
      i = j;
      continue;
    }
    const end = lastDigitEnd;
    const next = end < n ? input[end] : '';
    const boundary = !isAlnum(next);
    const hasPlus = c === '+';
    let mask: string | null = null;
    if (boundary && !looksLikeIsoDate(input, i)) {
      if (digits.length >= 13 && luhnValid(digits)) mask = SCRUB_MASKS.card;
      else if (digits.length >= 10 && digits.length <= 15) mask = SCRUB_MASKS.phone;
      else if (hasPlus && digits.length >= 7) mask = SCRUB_MASKS.phone;
    }
    out.push(mask ?? input.slice(i, end));
    i = end;
  }
  return out.join('');
}

function looksLikeJwt(token: string): boolean {
  if (!token.startsWith('eyJ')) return false;
  let dots = 0;
  let segment = 0;
  for (const c of token) {
    if (c === '.') {
      if (segment < 4) return false;
      dots++;
      segment = 0;
    } else if (isBase64Char(c) || c === '=') {
      segment++;
    } else {
      return false;
    }
  }
  return dots === 2 && segment >= 4;
}

function looksLikeSecret(token: string): boolean {
  if (token.length >= 32) {
    let allHex = true;
    let hasDigit = false;
    for (const c of token) {
      if (!isHexChar(c)) {
        allHex = false;
        break;
      }
      if (isDigit(c)) hasDigit = true;
    }
    if (allHex && hasDigit) return true;
  }
  if (token.length >= 40) {
    let digit = false;
    let lower = false;
    let upper = false;
    for (const c of token) {
      if (!isBase64Char(c)) return false;
      if (isDigit(c)) digit = true;
      else if (isLower(c)) lower = true;
      else if (isUpper(c)) upper = true;
    }
    return digit && lower && upper;
  }
  return false;
}

/** Masks every email address inside one token (a token may be a URL or path). */
function scrubEmailsInToken(token: string): string {
  if (!token.includes('@')) return token;
  let out = '';
  let cursor = 0;
  let i = token.indexOf('@');
  while (i !== -1) {
    let start = i;
    while (start > cursor && isEmailLocalChar(token[start - 1])) start--;
    let end = i + 1;
    let dot = false;
    while (end < token.length && isEmailDomainChar(token[end])) {
      if (token[end] === '.') dot = true;
      end++;
    }
    // Trailing dots belong to the sentence, not the domain.
    let domainEnd = end;
    while (domainEnd > i + 1 && token[domainEnd - 1] === '.') domainEnd--;
    const domain = token.slice(i + 1, domainEnd);
    if (start < i && dot && domain.includes('.') && !domain.startsWith('.')) {
      out += token.slice(cursor, start) + SCRUB_MASKS.email;
      cursor = domainEnd;
      i = token.indexOf('@', domainEnd);
    } else {
      i = token.indexOf('@', i + 1);
    }
  }
  return out + token.slice(cursor);
}

/**
 * Pass 2: split into tokens and separators in one pass; mask bearer and
 * basic credentials, values of password-like fields (key=value, key: value,
 * "key": "value"), JWTs, long hex/base64 secrets and email addresses.
 */
function scrubTokens(input: string): string {
  const out: string[] = [];
  let i = 0;
  const n = input.length;
  /** The next token is a credential value. */
  let maskNext = false;
  /** A sensitive key was seen; its value follows after ':' or '='. */
  let pendingKey = false;
  let sawAssign = false;
  while (i < n) {
    if (!isTokenChar(input[i])) {
      let j = i;
      while (j < n && !isTokenChar(input[j])) {
        const c = input[j];
        if (c === ':' || c === '=') sawAssign = true;
        if (c === '\n' || c === ',' || c === ';' || c === '&' || c === '}' || c === '{') {
          pendingKey = false;
          maskNext = false;
          sawAssign = false;
        }
        j++;
      }
      out.push(input.slice(i, j));
      i = j;
      continue;
    }
    let j = i;
    while (j < n && isTokenChar(input[j])) j++;
    const token = input.slice(i, j);
    i = j;

    if (maskNext || (pendingKey && sawAssign)) {
      out.push(SCRUB_MASKS.redacted);
      const lower = token.toLowerCase();
      // "Authorization: Bearer <x>": the scheme is masked and so is the credential.
      maskNext = lower === 'bearer' || lower === 'basic';
      pendingKey = false;
      sawAssign = false;
      continue;
    }
    sawAssign = false;
    const lower = token.length <= 10 ? token.toLowerCase() : '';
    if (lower === 'bearer' || lower === 'basic') {
      out.push(token);
      maskNext = true;
      continue;
    }
    if (isSensitiveKey(token)) {
      out.push(token);
      pendingKey = true;
      continue;
    }
    pendingKey = false;
    if (looksLikeJwt(token)) {
      out.push(SCRUB_MASKS.token);
      continue;
    }
    if (looksLikeSecret(token)) {
      out.push(SCRUB_MASKS.secret);
      continue;
    }
    out.push(scrubEmailsInToken(token));
  }
  return out.join('');
}

/**
 * Masks personal data and credentials in free text: phone numbers, emails,
 * JWT/bearer tokens, password-like fields, card-like digit sequences and
 * long hex/base64 secrets. Linear time. `maxLength` truncates the input
 * first (the scrubbed result never grows by more than a few mask words).
 */
export function scrubPii(input: string, maxLength = 20_000): string {
  if (!input) return input;
  const text = input.length > maxLength ? input.slice(0, maxLength) : input;
  return scrubTokens(scrubDigitRuns(text));
}

/** Scrubs a flat string map; values of sensitive keys are masked whatever they contain. */
export function scrubRecord(data: Record<string, string> | undefined, maxLength = 200): Record<string, string> | undefined {
  if (!data) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = isSensitiveKey(key) ? SCRUB_MASKS.redacted : scrubPii(String(value), maxLength);
  }
  return out;
}

export function scrubBreadcrumbs(crumbs: readonly Breadcrumb[] | undefined): Breadcrumb[] {
  if (!crumbs) return [];
  return crumbs.slice(-ERROR_LIMITS.breadcrumbs).map((b) => ({
    type: b.type,
    at: b.at,
    message: scrubPii(b.message, ERROR_LIMITS.breadcrumbMessageLength),
    ...(b.data ? { data: scrubRecord(b.data, ERROR_LIMITS.breadcrumbDataValueLength) } : {}),
  }));
}

/** Cuts a string to `max` characters. */
export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

function isUuidLike(token: string): boolean {
  if (token.length !== 36) return false;
  for (let i = 0; i < 36; i++) {
    const c = token[i];
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      if (c !== '-') return false;
    } else if (!isHexChar(c)) {
      return false;
    }
  }
  return true;
}

/**
 * Replaces the parts of a message that vary between occurrences of the
 * same error: UUIDs and other ids, long hex strings, and numbers. Linear.
 */
export function normalizeErrorMessage(message: string, maxLength = 300): string {
  const text = message.length > 2000 ? message.slice(0, 2000) : message;
  const out: string[] = [];
  let i = 0;
  let lastSpace = false;
  while (i < text.length) {
    const c = text[i];
    if (isAlnum(c) || c === '-' || c === '_') {
      let j = i;
      let digits = 0;
      let letters = 0;
      let hexOnly = true;
      while (j < text.length && (isAlnum(text[j]) || text[j] === '-' || text[j] === '_')) {
        const d = text[j];
        if (isDigit(d)) digits++;
        else if (isAlnum(d)) letters++;
        if (!isHexChar(d)) hexOnly = false;
        j++;
      }
      const token = text.slice(i, j);
      if (isUuidLike(token) || (token.length >= 8 && hexOnly && digits > 0) || (token.length >= 16 && digits > 0 && letters > 0)) {
        out.push('<id>');
      } else if (digits > 0) {
        let k = 0;
        let piece = '';
        while (k < token.length) {
          if (isDigit(token[k])) {
            while (k < token.length && isDigit(token[k])) k++;
            piece += '<n>';
          } else {
            piece += token[k];
            k++;
          }
        }
        out.push(piece);
      } else {
        out.push(token);
      }
      lastSpace = false;
      i = j;
      continue;
    }
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r') {
      if (!lastSpace) out.push(' ');
      lastSpace = true;
    } else {
      out.push(c);
      lastSpace = false;
    }
    i++;
  }
  return truncate(out.join('').trim(), maxLength);
}

/** Strips a trailing ":line" or ":line:col" (and a closing parenthesis) from a frame location. */
function stripLineCol(location: string): string {
  let end = location.length;
  if (location.endsWith(')')) end--;
  for (let pass = 0; pass < 2; pass++) {
    let k = end;
    while (k > 0 && isDigit(location[k - 1])) k--;
    if (k < end && k > 0 && location[k - 1] === ':') end = k - 1;
    else break;
  }
  return location.slice(0, end);
}

/** Drops the query string, hash and origin of a URL-like location. */
function stripUrlParts(location: string): string {
  let end = location.length;
  const q = location.indexOf('?');
  if (q !== -1) end = q;
  const h = location.indexOf('#');
  if (h !== -1 && h < end) end = h;
  let loc = location.slice(0, end);
  const scheme = loc.indexOf('://');
  if (scheme !== -1 && scheme < 12) {
    const slash = loc.indexOf('/', scheme + 3);
    loc = slash === -1 ? '' : loc.slice(slash);
  }
  return loc;
}

/**
 * The first stack frame that belongs to the application (not node_modules,
 * not Node internals), normalised: no line/column, no origin or query, ids
 * and content hashes replaced. Handles V8 ("at fn (file:1:2)") and
 * Firefox/Safari ("fn@file:1:2") formats. Null when no frame qualifies.
 */
export function topInAppFrame(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const lines = stack.length > ERROR_LIMITS.stackLength ? stack.slice(0, ERROR_LIMITS.stackLength) : stack;
  let start = 0;
  for (let count = 0; count < 60 && start < lines.length; count++) {
    let end = lines.indexOf('\n', start);
    if (end === -1) end = lines.length;
    const line = lines.slice(start, end).trim();
    start = end + 1;
    let fn = '';
    let location = '';
    if (line.startsWith('at ')) {
      const rest = line.slice(3);
      const paren = rest.lastIndexOf(' (');
      if (paren !== -1 && rest.endsWith(')')) {
        fn = rest.slice(0, paren);
        location = rest.slice(paren + 2);
      } else {
        location = rest;
      }
    } else {
      const at = line.indexOf('@');
      if (at === -1 || !line.includes(':')) continue;
      fn = line.slice(0, at);
      location = line.slice(at + 1);
    }
    if (!location) continue;
    if (location.includes('node_modules') || location.startsWith('node:') || location.includes('(native)') || location === '<anonymous>') continue;
    const normalizedLocation = normalizeErrorMessage(stripUrlParts(stripLineCol(location)), 200);
    if (!normalizedLocation) continue;
    return truncate(`${fn ? `${normalizeErrorMessage(fn, 100)} ` : ''}${normalizedLocation}`, 300);
  }
  return null;
}

/**
 * Groups events: source + error type + normalised message + top in-app
 * frame. The API stores sha256 of this string as the group key.
 */
export function errorFingerprint(event: { source: string; type: string; message: string; stack?: string | null }): string {
  const frame = topInAppFrame(event.stack) ?? '';
  return `${event.source}|${truncate(event.type, ERROR_LIMITS.typeLength)}|${normalizeErrorMessage(event.message)}|${frame}`;
}

/** A group's display title: the type and the normalised, scrubbed message. */
export function errorGroupTitle(type: string, message: string): string {
  const msg = normalizeErrorMessage(scrubPii(message, 2000), ERROR_LIMITS.titleLength);
  return truncate(msg ? `${type}: ${msg}` : type, ERROR_LIMITS.titleLength);
}

/**
 * Login, authentication, payment and billing routes are critical flows: any
 * error there alerts super admins even when its group is not new.
 */
const CRITICAL_SEGMENTS = new Set(['auth', 'login', 'otp', 'pin', 'payments', 'payment', 'billing', 'checkout', 'giris', 'odeme', 'abonelik']);
export function isCriticalRoute(route: string | null | undefined): boolean {
  if (!route) return false;
  const segments = route.slice(0, ERROR_LIMITS.routeLength).toLowerCase().split('/');
  return segments.some((s) => CRITICAL_SEGMENTS.has(s));
}

/**
 * Replaces id-like path segments so routes group and never carry
 * identifiers: "/studios/0b1c.../members/42" -> "/studios/:id/members/:id".
 */
export function normalizeRoute(path: string): string {
  const q = path.indexOf('?');
  const clean = truncate(q === -1 ? path : path.slice(0, q), ERROR_LIMITS.routeLength);
  return clean
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      let digits = 0;
      let hexOnly = true;
      for (const c of seg) {
        if (isDigit(c)) digits++;
        if (!isHexChar(c) && c !== '-') hexOnly = false;
      }
      if (isUuidLike(seg) || (digits > 0 && (hexOnly || digits === seg.length || seg.length >= 16))) return ':id';
      return seg;
    })
    .join('/');
}

// ---------------------------------------------------------------------------
// Dedupe and sampling
// ---------------------------------------------------------------------------

/**
 * Accepts an identical fingerprint at most once per window per source.
 * Bounded: the oldest keys are dropped beyond `maxKeys`.
 */
export class ErrorDedupeWindow {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly windowMs = 1000,
    private readonly maxKeys = 5000,
  ) {}

  accept(source: string, fingerprint: string, nowMs: number): boolean {
    const key = `${source}\u0000${fingerprint}`;
    const last = this.seen.get(key);
    if (last !== undefined && nowMs - last < this.windowMs) return false;
    this.seen.delete(key);
    this.seen.set(key, nowMs);
    if (this.seen.size > this.maxKeys) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }
}

/** Keeps an event with probability `rate` (0..1); `random` is injectable for tests. */
export function sampleEvent(rate: number, random: () => number = Math.random): boolean {
  if (!(rate > 0)) return false;
  if (rate >= 1) return true;
  return random() < rate;
}

/**
 * Whether a RESOLVED group seen again in `release` is a regression: any
 * release other than the one the fix shipped in (or when none was recorded).
 */
export function isRegression(status: ErrorGroupStatus, resolvedInRelease: string | null, release: string): boolean {
  return status === 'RESOLVED' && resolvedInRelease !== release;
}

/** Whether an alert may be sent now given the last one (cooldown per group). */
export function alertCooldownPassed(lastAlertAt: Date | null, now: Date, cooldownMs: number): boolean {
  return !lastAlertAt || now.getTime() - lastAlertAt.getTime() >= cooldownMs;
}
