import { toOgLocale } from './og-locale';

describe('toOgLocale', () => {
  it('maps a language to language_TERRITORY', () => {
    expect(toOgLocale('tr')).toBe('tr_TR');
    expect(toOgLocale('en')).toBe('en_US');
  });

  it('keeps an explicit region', () => {
    expect(toOgLocale('en-GB')).toBe('en_GB');
  });

  it('falls back to the input for an invalid tag', () => {
    expect(toOgLocale('not a locale')).toBe('not a locale');
  });
});
