import * as Localization from 'expo-localization';
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { AppState } from 'react-native';

import { BASE_LOCALE, BASE_MESSAGES, BUNDLED_LANGUAGES, BUNDLED_MESSAGES, createTranslator } from '@platform/shared';
import { resolveLocale } from '@platform/shared';
import type { PublicLanguagesDTO, Translate } from '@platform/shared';

import { apiRequest } from '../lib/api';
import { useSession } from '../lib/session';
import { fetchLocaleMessages, fetchPublicLanguages } from './fetchMessages';
import { buildLocaleCandidates, mergeMessages, shouldRefetchMessages } from './localeResolution';
import {
  getCachedLanguages,
  getCachedMessages,
  getStoredLocaleChoice,
  setCachedLanguages,
  setCachedMessages,
  setStoredLocaleChoice,
} from './storage';
import type { CachedMessages } from './storage';

/**
 * App-wide translation and locale state. Resolution order and caching rules
 * are documented in docs/MOBILE_APP.md ("Mobil uygulamada dil"):
 * 1. render immediately from BUNDLED_MESSAGES[locale] (no network wait);
 * 2. layer the cached /i18n/messages/:locale response over it, if any;
 * 3. refetch with If-None-Match at most every MESSAGES_REFRESH_INTERVAL_MS,
 *    including on app foreground.
 */

const FALLBACK_LANGUAGES: PublicLanguagesDTO = {
  baseLocale: BASE_LOCALE,
  items: BUNDLED_LANGUAGES.map(({ code, name, nativeName }) => ({ code, name, nativeName })),
};

interface I18nContextValue {
  locale: string;
  baseLocale: string;
  t: Translate;
  languages: PublicLanguagesDTO['items'];
  isSettingLocale: boolean;
  /** null follows the active studio's default locale (PUT /me/locale contract). */
  setLocale: (locale: string | null) => Promise<void>;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readDeviceLocales(): string[] {
  try {
    return Localization.getLocales()
      .map((entry) => entry.languageTag)
      .filter((tag): tag is string => Boolean(tag));
  } catch {
    // expo-localization is unavailable in some test/dev runners.
    return [];
  }
}

export function I18nProvider({ children }: { children: ReactNode }): ReactElement {
  const { user, activeMembership, refreshUser } = useSession();

  const [deviceLocales] = useState<string[]>(readDeviceLocales);
  const [storedLocale, setStoredLocale] = useState<string | null>(null);
  const [languages, setLanguages] = useState<PublicLanguagesDTO>(FALLBACK_LANGUAGES);
  const [messagesCache, setMessagesCache] = useState<CachedMessages | null>(null);
  const [isSettingLocale, setIsSettingLocale] = useState(false);

  // Pre-sign-in choice and the last language list snapshot, both cached on
  // device so the app works fully offline right after launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [choice, cachedLanguages] = await Promise.all([getStoredLocaleChoice(), getCachedLanguages()]);
      if (cancelled) return;
      if (choice) setStoredLocale(choice);
      if (cachedLanguages) setLanguages(cachedLanguages.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh the enabled-languages list from the server; never blocks first render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fresh = await fetchPublicLanguages();
      if (!fresh || cancelled) return;
      setLanguages(fresh);
      await setCachedLanguages({ data: fresh, fetchedAt: Date.now() });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enabledCodes = useMemo(() => languages.items.map((item) => item.code), [languages]);

  const locale = useMemo(
    () =>
      resolveLocale(
        enabledCodes,
        buildLocaleCandidates({
          isSignedIn: Boolean(user),
          userLocale: user?.locale,
          studioDefaultLocale: activeMembership?.defaultLocale,
          storedLocale,
          deviceLocales,
        }),
      ),
    [enabledCodes, user, activeMembership?.defaultLocale, storedLocale, deviceLocales],
  );

  const localeRef = useRef(locale);
  localeRef.current = locale;

  const refetchMessages = useCallback(async (forLocale: string, knownVersion?: string) => {
    const result = await fetchLocaleMessages(forLocale, knownVersion);
    if (result.status === 'ok') {
      const entry: CachedMessages = {
        locale: forLocale,
        version: result.data.version,
        messages: result.data.messages,
        fetchedAt: Date.now(),
      };
      await setCachedMessages(entry);
      if (localeRef.current === forLocale) setMessagesCache(entry);
    } else if (result.status === 'not-modified' && knownVersion) {
      const refreshed: CachedMessages = {
        locale: forLocale,
        version: knownVersion,
        messages: (await getCachedMessages(forLocale))?.messages ?? {},
        fetchedAt: Date.now(),
      };
      await setCachedMessages(refreshed);
      if (localeRef.current === forLocale) setMessagesCache((current) => (current ? { ...current, fetchedAt: refreshed.fetchedAt } : current));
    }
    // 'error': keep whatever is cached; the app already rendered from it.
  }, []);

  // Loads this locale's cache immediately, then refetches when due.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await getCachedMessages(locale);
      if (cancelled) return;
      setMessagesCache(cached);
      if (shouldRefetchMessages(cached, locale, Date.now())) {
        await refetchMessages(locale, cached?.version);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, refetchMessages]);

  // Re-check on foreground, at most once per MESSAGES_REFRESH_INTERVAL_MS.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      (async () => {
        const current = localeRef.current;
        const cached = await getCachedMessages(current);
        if (shouldRefetchMessages(cached, current, Date.now())) {
          await refetchMessages(current, cached?.version);
        }
      })();
    });
    return () => subscription.remove();
  }, [refetchMessages]);

  const messages = useMemo(() => {
    const bundled = BUNDLED_MESSAGES[locale] ?? BASE_MESSAGES;
    return mergeMessages(bundled, messagesCache?.locale === locale ? messagesCache.messages : null);
  }, [locale, messagesCache]);

  const t = useMemo<Translate>(
    () =>
      createTranslator({
        locale,
        messages,
        fallback: BASE_MESSAGES,
        onMissing: __DEV__
          ? (key, loc) => console.warn(`[i18n] missing message "${key}" for locale "${loc}"`)
          : undefined,
      }),
    [locale, messages],
  );

  const setLocale = useCallback(
    async (next: string | null) => {
      setIsSettingLocale(true);
      try {
        if (user) {
          await apiRequest<{ locale: string | null }>('/me/locale', { method: 'PUT', body: { locale: next } });
          await refreshUser();
        }
        // Kept as the device-level fallback so the choice survives sign-out too.
        setStoredLocale(next);
        await setStoredLocaleChoice(next);
      } finally {
        setIsSettingLocale(false);
      }
    },
    [user, refreshUser],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, baseLocale: languages.baseLocale, t, languages: languages.items, isSettingLocale, setLocale }),
    [locale, languages, t, isSettingLocale, setLocale],
  );

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}

/** Translate function bound to the active locale. */
export function useT(): Translate {
  return useI18n().t;
}

export function useLocale(): {
  locale: string;
  baseLocale: string;
  languages: PublicLanguagesDTO['items'];
  isSettingLocale: boolean;
  setLocale: (locale: string | null) => Promise<void>;
} {
  const { locale, baseLocale, languages, isSettingLocale, setLocale } = useI18n();
  return { locale, baseLocale, languages, isSettingLocale, setLocale };
}
