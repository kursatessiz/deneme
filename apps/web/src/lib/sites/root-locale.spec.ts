import { negotiateRootLocale } from './root-locale';

const base = { cookie: null, acceptLanguage: null, published: ['tr', 'en'], defaultLocale: 'tr' };

describe('negotiateRootLocale', () => {
  it('prefers the cookie over Accept-Language', () => {
    expect(negotiateRootLocale({ ...base, cookie: 'en', acceptLanguage: 'tr-TR,tr;q=0.9' })).toBe('en');
  });

  it('matches a region tag to the published language', () => {
    expect(negotiateRootLocale({ ...base, acceptLanguage: 'en-GB,en;q=0.8' })).toBe('en');
  });

  it('skips locales the home page is not published in', () => {
    expect(negotiateRootLocale({ ...base, cookie: 'de', acceptLanguage: 'fr,en;q=0.5' })).toBe('en');
  });

  it('falls back to the site default, then the first published locale', () => {
    expect(negotiateRootLocale({ ...base, acceptLanguage: 'de' })).toBe('tr');
    expect(negotiateRootLocale({ ...base, acceptLanguage: 'de', defaultLocale: 'fr' })).toBe('tr');
    expect(negotiateRootLocale({ ...base, published: ['en'], defaultLocale: null })).toBe('en');
  });

  it('uses the base locale when nothing is published', () => {
    expect(negotiateRootLocale({ ...base, published: [], acceptLanguage: 'en' })).toBe('tr');
  });
});
