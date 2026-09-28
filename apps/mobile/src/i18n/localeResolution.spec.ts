import { resolveLocale } from '@platform/shared';

import {
  buildLocaleCandidates,
  mergeMessages,
  MESSAGES_REFRESH_INTERVAL_MS,
  shouldRefetchMessages,
} from './localeResolution';

describe('buildLocaleCandidates', () => {
  it('orders the user choice before the studio default, then the device, when signed in', () => {
    const candidates = buildLocaleCandidates({
      isSignedIn: true,
      userLocale: 'en',
      studioDefaultLocale: 'de',
      storedLocale: 'fr',
      deviceLocales: ['pt-BR'],
    });
    expect(candidates).toEqual(['en', 'de', 'pt-BR']);
  });

  it('uses the locally stored choice before the device when signed out', () => {
    const candidates = buildLocaleCandidates({
      isSignedIn: false,
      storedLocale: 'en',
      deviceLocales: ['de-DE', 'fr'],
    });
    expect(candidates).toEqual(['en', 'de-DE', 'fr']);
  });

  it('resolves to the base locale end-to-end when nothing enabled matches', () => {
    const candidates = buildLocaleCandidates({
      isSignedIn: true,
      userLocale: null,
      studioDefaultLocale: null,
      deviceLocales: ['de-DE'],
    });
    expect(resolveLocale(['tr', 'en'], candidates)).toBe('tr');
  });

  it('resolves to the user choice end-to-end when it is enabled', () => {
    const candidates = buildLocaleCandidates({
      isSignedIn: true,
      userLocale: 'en',
      studioDefaultLocale: 'tr',
      deviceLocales: [],
    });
    expect(resolveLocale(['tr', 'en'], candidates)).toBe('en');
  });
});

describe('shouldRefetchMessages', () => {
  const now = 1_700_000_000_000;

  it('is true with no cache on record', () => {
    expect(shouldRefetchMessages(null, 'en', now)).toBe(true);
  });

  it('is true when the cached locale differs from the active one', () => {
    expect(shouldRefetchMessages({ locale: 'tr', fetchedAt: now }, 'en', now)).toBe(true);
  });

  it('is false right after a fetch of the same locale', () => {
    expect(shouldRefetchMessages({ locale: 'en', fetchedAt: now }, 'en', now)).toBe(false);
  });

  it('is false just under the refresh interval and true at or past it', () => {
    const fetchedAt = now - MESSAGES_REFRESH_INTERVAL_MS + 1000;
    expect(shouldRefetchMessages({ locale: 'en', fetchedAt }, 'en', now)).toBe(false);
    expect(shouldRefetchMessages({ locale: 'en', fetchedAt: now - MESSAGES_REFRESH_INTERVAL_MS }, 'en', now)).toBe(
      true,
    );
  });

  it('honors a custom interval', () => {
    expect(shouldRefetchMessages({ locale: 'en', fetchedAt: now - 5000 }, 'en', now, 1000)).toBe(true);
    expect(shouldRefetchMessages({ locale: 'en', fetchedAt: now - 500 }, 'en', now, 1000)).toBe(false);
  });
});

describe('mergeMessages', () => {
  it('returns the bundled messages unchanged with no override', () => {
    const bundled = { 'a.b': '1' };
    expect(mergeMessages(bundled, null)).toEqual({ 'a.b': '1' });
    expect(mergeMessages(bundled, undefined)).toEqual({ 'a.b': '1' });
  });

  it('layers override values over the bundled ones without mutating the input', () => {
    const bundled = { 'a.b': '1', 'a.c': '2' };
    const merged = mergeMessages(bundled, { 'a.c': '3', 'a.d': '4' });
    expect(merged).toEqual({ 'a.b': '1', 'a.c': '3', 'a.d': '4' });
    expect(bundled).toEqual({ 'a.b': '1', 'a.c': '2' });
  });
});
