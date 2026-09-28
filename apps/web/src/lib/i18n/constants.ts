/** Shared between server (locale.ts) and client (client.ts) code, so it carries no server-only imports. */
export const PW_LOCALE_COOKIE = 'pw_locale';

/**
 * Request header carrying the locale a public site page is rendered in,
 * set by the middleware from the URL's first segment (`/en/...`). The root
 * layout reads it so `<html lang>` and the client messages match the page.
 */
export const PAGE_LOCALE_HEADER = 'x-pw-page-locale';
