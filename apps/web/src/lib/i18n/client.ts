'use client';

import { PW_LOCALE_COOKIE } from './constants';

/** Client-side cookie writer, same shape as active-selection.ts's setPlainCookie. */
export function setPwLocaleCookie(locale: string) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${PW_LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}
