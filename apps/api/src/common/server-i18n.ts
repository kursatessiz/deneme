import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpException, Injectable, NestMiddleware } from '@nestjs/common';
import type { PrismaClient } from '@platform/database';
import {
  BASE_LOCALE,
  BASE_MESSAGES,
  BUNDLED_MESSAGES,
  createTranslator,
  parseAcceptLanguage,
  resolveLocale,
  translateApiErrorBody,
} from '@platform/shared';
import type { ApiErrorKey, MessageKey, MessageParams, Translate, ValidationKey } from '@platform/shared';
import type { ApiTextKey } from '@platform/shared';

/**
 * Server-side translation for text the API produces itself (docs/I18N.md,
 * "API metinleri"). Three audiences, three ways to pick the language:
 *
 *  - the person who made the request (success messages, CSV headers, labels):
 *    `requestT()`, from the Accept-Language header web and mobile forward;
 *  - a notification recipient: `recipientLocale()` (their own language, then
 *    the business default, then Turkish) and `serverT(locale)`;
 *  - a record stored for later reading: the business default language,
 *    `studioLocale()`.
 *
 * Only the bundled catalogues (tr, en) are used here; a language added from
 * the CMS falls back through its base language to the next candidate and
 * finally to Turkish.
 */

/** Any key a server text can use: the dedicated namespaces plus every bundled message. */
export type ServerTextKey = ApiTextKey | ApiErrorKey | ValidationKey | MessageKey;
export type ServerT = (key: ServerTextKey, params?: MessageParams) => string;

const BUNDLED_CODES = Object.keys(BUNDLED_MESSAGES);

/** First candidate with bundled messages (a regional tag matches its language); Turkish when none does. */
export function pickBundledLocale(candidates: ReadonlyArray<string | null | undefined>): string {
  return resolveLocale(BUNDLED_CODES, candidates);
}

const translators = new Map<string, Translate>();

/** Translator for one bundled locale (cached); an unknown locale renders Turkish. */
export function serverT(locale?: string | null): ServerT {
  const code = pickBundledLocale([locale]);
  let t = translators.get(code);
  if (!t) {
    t = createTranslator({ locale: code, messages: BUNDLED_MESSAGES[code] ?? BASE_MESSAGES, fallback: BASE_MESSAGES });
    translators.set(code, t);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Request language
// ---------------------------------------------------------------------------

interface RequestLocaleStore {
  locale: string;
  /** True when the request named a bundled language; false when Turkish is only the default. */
  explicit: boolean;
}

const requestLocaleStore = new AsyncLocalStorage<RequestLocaleStore>();

function readRequestLocale(header: string | string[] | undefined): RequestLocaleStore {
  const value = Array.isArray(header) ? header.join(',') : header;
  const tags = parseAcceptLanguage(value);
  const explicit = tags.some((tag) => BUNDLED_CODES.includes(tag.split('-')[0].toLowerCase()));
  return { locale: pickBundledLocale([...tags, BASE_LOCALE]), explicit };
}

/** Language of an Accept-Language header among the bundled ones; Turkish when absent. */
export function localeFromAcceptLanguage(header: string | string[] | undefined): string {
  return readRequestLocale(header).locale;
}

/** Keeps the requester's language for the whole request, so services need no extra parameter. */
@Injectable()
export class RequestLocaleMiddleware implements NestMiddleware {
  use(req: { headers: Record<string, string | string[] | undefined> }, _res: unknown, next: () => void): void {
    requestLocaleStore.run(readRequestLocale(req.headers['accept-language']), next);
  }
}

/** Language of the current request; Turkish outside a request (jobs, scripts). */
export function requestLocale(): string {
  return requestLocaleStore.getStore()?.locale ?? BASE_LOCALE;
}

/** Language the current request asked for, or null when it named none (so a business default can apply). */
export function requestedLocale(): string | null {
  const store = requestLocaleStore.getStore();
  return store?.explicit ? store.locale : null;
}

/** Translator for the language of the current request. */
export function requestT(): ServerT {
  return serverT(requestLocale());
}

// ---------------------------------------------------------------------------
// Recipient and business language
// ---------------------------------------------------------------------------

type LocaleDb = Pick<PrismaClient, 'user' | 'studio' | 'contact'>;

/** Default language of a business; Turkish when it is unknown. */
export async function studioLocale(db: Pick<PrismaClient, 'studio'>, studioId: string | null | undefined): Promise<string> {
  if (!studioId) return BASE_LOCALE;
  const studio = await db.studio.findUnique({ where: { id: studioId }, select: { defaultLocale: true } });
  return pickBundledLocale([studio?.defaultLocale]);
}

/**
 * Language a message to this recipient is written in: their own choice
 * (`User.locale`, or `Contact.locale` for a CRM contact), else the business
 * default (`Studio.defaultLocale`), else Turkish. The messaging engine's
 * template lookup walks the same chain (`localeChain`).
 */
export async function recipientLocale(
  db: LocaleDb,
  ref: { userId?: string | null; contactId?: string | null; studioId?: string | null },
): Promise<string> {
  const [user, contact, studio] = await Promise.all([
    ref.userId ? db.user.findUnique({ where: { id: ref.userId }, select: { locale: true } }) : null,
    ref.contactId ? db.contact.findUnique({ where: { id: ref.contactId }, select: { locale: true } }) : null,
    ref.studioId ? db.studio.findUnique({ where: { id: ref.studioId }, select: { defaultLocale: true } }) : null,
  ]);
  return pickBundledLocale([user?.locale, contact?.locale, studio?.defaultLocale]);
}

/**
 * Message of an HttpException in the language of `t`: an `apiError()` body is
 * translated by its code, any other body keeps its own message.
 */
export function errorMessageIn(err: HttpException, t: ServerT): string {
  const body = err.getResponse();
  if (typeof body !== 'object' || body === null) return err.message;
  return String(translateApiErrorBody(body as Record<string, unknown>, t)?.message ?? err.message);
}
