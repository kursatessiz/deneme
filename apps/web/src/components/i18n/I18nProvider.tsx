'use client';

import { createContext, useContext, useMemo } from 'react';
import { registerClientTranslator } from '@/lib/i18n/client-translator';
import { BASE_MESSAGES, createTranslator, type MessageParams, type Translate } from '@platform/shared';

interface I18nContextValue {
  locale: string;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Provides the resolved locale and its messages (bundled + CMS overrides,
 * loaded server-side) to every client component below it. Falls back to
 * the Turkish base message for any key missing from the active locale, so
 * a half-translated language never shows a raw key to the user.
 */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: Readonly<Record<string, string>>;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nContextValue>(() => {
    const t = createTranslator({ locale, messages, fallback: BASE_MESSAGES });
    registerClientTranslator(t);
    return { locale, t };
  }, [locale, messages]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** `const t = useT()` in a client component; `t('key', { name: 'Ada' })`. */
export function useT(): Translate {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // A component rendered outside I18nProvider (e.g. in an isolated test)
    // still gets Turkish text instead of crashing.
    return (key: string, params?: MessageParams) => createTranslator({ locale: 'tr', messages: BASE_MESSAGES, fallback: BASE_MESSAGES })(key, params);
  }
  return ctx.t;
}

/** The resolved locale, e.g. for `Intl` formatting or a language switcher's current value. */
export function useLocale(): string {
  const ctx = useContext(I18nContext);
  return ctx?.locale ?? 'tr';
}
