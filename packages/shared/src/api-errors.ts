import { AI_ERROR_CODES } from './ai/api';
import { BACKUP_ERROR_CODES } from './backups';
import { TRANSLATED_API_ERROR_CODES } from './billing';
import { COMMUNITY_ERROR_CODES } from './community';
import { EVENT_ERROR_CODES } from './events';
import { BASE_MESSAGES } from './i18n/messages';
import type { trApiErrors } from './i18n/messages/tr/apiErrors';
import { hasOwn } from './i18n/own';
import { createTranslator } from './i18n/translator';
import type { MessageParams, Translate } from './i18n/translator';
import { LOYALTY_ERROR_CODES } from './loyalty';
import { MARKETING_STUDIO_ERROR_CODES } from './marketing/drafts';
import { RETAIL_ERROR_CODES } from './retail';
import { ARTICLE_ERROR_CODES } from './sites/articles';
import { THEME_FAMILY_NOT_ALLOWED } from './admin';

/**
 * API error messages (docs/I18N.md, "API hata mesajları").
 *
 * The API answers a user-facing failure with a body
 * `{ code: '<apiErrors key>', message: '<Turkish text>', params? }`. The Turkish
 * `message` keeps old clients working; web and mobile replace it with the
 * viewer's language through `translateApiErrorBody`.
 */

type PluralBase<K> = K extends `${infer B}.one` | `${infer B}.other` ? B : K;

/** Every `apiErrors.<module>.<name>` message key (plural keys without their `.one`/`.other` suffix). */
export type ApiErrorKey = PluralBase<keyof typeof trApiErrors>;

/** Values a message can interpolate: `{name}` placeholders, `count` for plural keys. */
export type ApiErrorParams = MessageParams;

export const API_ERROR_KEY_PREFIX = 'apiErrors.';

/**
 * Body of an API error as the API sends it. `code` is the message key itself;
 * an error that keeps an older stable code (TRANSLATION_JOB_ACTIVE, ...) puts
 * its message key in `messageKey` instead.
 */
export interface ApiErrorResponse {
  code: string;
  messageKey?: ApiErrorKey;
  message: string;
  params?: ApiErrorParams;
}

const BASE_TRANSLATE: Translate = createTranslator({ locale: 'tr', messages: BASE_MESSAGES, fallback: BASE_MESSAGES });

/** True when `code` is an `apiErrors.*` message key (a plural key is accepted by its base name). */
export function isApiErrorKey(code: unknown): code is ApiErrorKey {
  if (typeof code !== 'string' || !code.startsWith(API_ERROR_KEY_PREFIX)) return false;
  return hasOwn(BASE_MESSAGES, code) || hasOwn(BASE_MESSAGES, `${code}.other`);
}

/** The Turkish base text of an error key, with its params interpolated. */
export function apiErrorBaseMessage(key: ApiErrorKey, params?: ApiErrorParams): string {
  return BASE_TRANSLATE(key, params);
}

/** Builds the error response body: stable `code` (the key), Turkish `message` and the `params`. */
export function buildApiErrorResponse(key: ApiErrorKey, params?: ApiErrorParams, legacyCode?: string): ApiErrorResponse {
  const head: Pick<ApiErrorResponse, 'code' | 'messageKey'> = legacyCode ? { code: legacyCode, messageKey: key } : { code: key };
  return params ? { ...head, message: apiErrorBaseMessage(key, params), params } : { ...head, message: apiErrorBaseMessage(key) };
}

function moduleCodeKeys(): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  const families: ReadonlyArray<readonly [readonly string[], string]> = [
    [RETAIL_ERROR_CODES, 'retail.error.'],
    [LOYALTY_ERROR_CODES, 'loyalty.error.'],
    [COMMUNITY_ERROR_CODES, 'community.error.'],
    [EVENT_ERROR_CODES, 'events.error.'],
    [ARTICLE_ERROR_CODES, 'articles.error.'],
    [AI_ERROR_CODES, 'ai.error.'],
    [BACKUP_ERROR_CODES, 'adminBackups.error.'],
    [MARKETING_STUDIO_ERROR_CODES, 'marketingStudio.error.'],
    [[THEME_FAMILY_NOT_ALLOWED], 'themeDesign.error.'],
  ];
  for (const [codes, prefix] of families) {
    for (const code of codes) if (hasOwn(BASE_MESSAGES, prefix + code)) out[code] = prefix + code;
  }
  return out;
}

/**
 * Older stable codes (RETAIL_PRODUCT_NOT_FOUND, COMMUNITY_POST_NOT_FOUND, ...)
 * mapped to the message key of their module. Together with
 * TRANSLATED_API_ERROR_CODES they let any screen show the translated text of
 * a coded error without knowing the module.
 */
export const MODULE_API_ERROR_CODE_KEYS: Readonly<Record<string, string>> = moduleCodeKeys();

/** The message key an error code is translated with, or null when the code has no shared translation. */
export function apiErrorMessageKey(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  if (isApiErrorKey(code)) return code;
  if (hasOwn(TRANSLATED_API_ERROR_CODES, code)) return TRANSLATED_API_ERROR_CODES[code];
  if (hasOwn(MODULE_API_ERROR_CODE_KEYS, code)) return MODULE_API_ERROR_CODE_KEYS[code];
  return null;
}

/**
 * Turkish base text of a coded error (`BILLING_RESTRICTED`, `RETAIL_SALE_NOT_FOUND`, an apiErrors key, ...),
 * or null when the code has no shared translation.
 */
export function apiErrorBaseMessageForCode(code: string, params?: ApiErrorParams): string | null {
  const key = apiErrorMessageKey(code);
  return key ? BASE_TRANSLATE(key, params) : null;
}

function readParams(value: unknown): ApiErrorParams | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [name, v] of Object.entries(value)) {
    if (typeof v === 'string' || typeof v === 'number') out[name] = v;
  }
  return out;
}

/**
 * Replaces the `message` of an API error body with the translation of its
 * `code` (and `params`) using `t`. A body without a translatable code is
 * returned as is, so its server message still shows.
 */
export function translateApiErrorBody<T extends Record<string, unknown>>(body: T | null, t: Translate): T | null {
  if (!body) return body;
  const key = isApiErrorKey(body.messageKey) ? body.messageKey : apiErrorMessageKey(body.code);
  if (!key) return body;
  return { ...body, message: t(key, readParams(body.params)) };
}
