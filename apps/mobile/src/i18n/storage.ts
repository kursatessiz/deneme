import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PublicLanguagesDTO } from '@platform/shared';

/**
 * Local persistence for i18n state. Uses AsyncStorage (not expo-secure-store,
 * which apps/mobile reserves for auth tokens per tokenStore.ts): none of
 * this is a secret, and it must survive across the pre-sign-in flow, where
 * there is no session to attach a server-side preference to.
 */

const LOCALE_CHOICE_KEY = 'platform.i18n.localeChoice';
const LANGUAGES_KEY = 'platform.i18n.languages';
const messagesKey = (locale: string) => `platform.i18n.messages.${locale}`;

export interface CachedMessages {
  locale: string;
  version: string;
  messages: Record<string, string>;
  fetchedAt: number;
}

export interface CachedLanguages {
  data: PublicLanguagesDTO;
  fetchedAt: number;
}

/** The locale picked before sign-in (Dil screen while signed out, or a bare device guess). Never throws. */
export async function getStoredLocaleChoice(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LOCALE_CHOICE_KEY);
  } catch {
    return null;
  }
}

export async function setStoredLocaleChoice(locale: string | null): Promise<void> {
  try {
    if (locale) {
      await AsyncStorage.setItem(LOCALE_CHOICE_KEY, locale);
    } else {
      await AsyncStorage.removeItem(LOCALE_CHOICE_KEY);
    }
  } catch {
    // Best effort: the in-memory value still drives this session.
  }
}

export async function getCachedMessages(locale: string): Promise<CachedMessages | null> {
  try {
    const raw = await AsyncStorage.getItem(messagesKey(locale));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedMessages;
    if (parsed && typeof parsed.version === 'string' && parsed.messages && typeof parsed.fetchedAt === 'number') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setCachedMessages(entry: CachedMessages): Promise<void> {
  try {
    await AsyncStorage.setItem(messagesKey(entry.locale), JSON.stringify(entry));
  } catch {
    // Cache is an optimization; a failed write just means a refetch next time.
  }
}

export async function getCachedLanguages(): Promise<CachedLanguages | null> {
  try {
    const raw = await AsyncStorage.getItem(LANGUAGES_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedLanguages;
  } catch {
    return null;
  }
}

export async function setCachedLanguages(entry: CachedLanguages): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGES_KEY, JSON.stringify(entry));
  } catch {
    // Same as setCachedMessages: best effort.
  }
}
