import {
  DEFAULT_SITE_SEO_SETTINGS,
  SearchVerificationTokenSchema,
  UpdateSiteSeoSettingsSchema,
  buildIndexNowPayload,
  indexNowUrlsForArticle,
  indexNowUrlsForPage,
  mergeSiteSeoSettings,
  parseSiteSeoSettings,
} from './index';

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('sites/seo settings', () => {
  it('accepts a verification token and turns an empty string into null', () => {
    expect(SearchVerificationTokenSchema.parse('AbC123_-xyzAbC123')).toBe('AbC123_-xyzAbC123');
    expect(SearchVerificationTokenSchema.parse('')).toBeNull();
    expect(SearchVerificationTokenSchema.parse('   ')).toBeNull();
    expect(SearchVerificationTokenSchema.parse(null)).toBeNull();
  });

  it('rejects tokens that could carry markup or are too short', () => {
    expect(SearchVerificationTokenSchema.safeParse('abc').success).toBe(false);
    expect(SearchVerificationTokenSchema.safeParse('"><script>alert(1)</script>').success).toBe(false);
    expect(SearchVerificationTokenSchema.safeParse('has space inside').success).toBe(false);
  });

  it('rejects unknown fields of the update', () => {
    expect(UpdateSiteSeoSettingsSchema.safeParse({ indexNowKey: KEY }).success).toBe(false);
    expect(UpdateSiteSeoSettingsSchema.safeParse({ googleSiteVerification: 'abcdefgh1234' }).success).toBe(true);
  });

  it('falls back per field when the stored JSON is malformed', () => {
    expect(parseSiteSeoSettings(undefined)).toEqual(DEFAULT_SITE_SEO_SETTINGS);
    expect(parseSiteSeoSettings([])).toEqual(DEFAULT_SITE_SEO_SETTINGS);
    expect(parseSiteSeoSettings({ googleSiteVerification: '<b>', bingSiteVerification: 'goodtoken123', indexNowKey: 'short' })).toEqual({
      googleSiteVerification: null,
      bingSiteVerification: 'goodtoken123',
      indexNowKey: null,
    });
  });

  it('merges only the fields that are given and can clear one', () => {
    const current = { ...DEFAULT_SITE_SEO_SETTINGS, googleSiteVerification: 'googletoken1', indexNowKey: KEY };
    expect(mergeSiteSeoSettings(current, { bingSiteVerification: 'bingtoken123' })).toEqual({ ...current, bingSiteVerification: 'bingtoken123' });
    expect(mergeSiteSeoSettings(current, { googleSiteVerification: null })).toEqual({ ...current, googleSiteVerification: null });
    expect(mergeSiteSeoSettings(current, {})).toEqual(current);
  });
});

describe('sites/indexnow payload', () => {
  const origin = 'https://zen.example.com';

  it('builds the request body for one host with the key file location', () => {
    const payload = buildIndexNowPayload({ origin, key: KEY, urls: [`${origin}/tr`, `${origin}/en/pricing`] });
    expect(payload).toEqual({ host: 'zen.example.com', key: KEY, keyLocation: `${origin}/${KEY}.txt`, urlList: [`${origin}/tr`, `${origin}/en/pricing`] });
  });

  it('keeps only URLs of the host, without duplicates', () => {
    const payload = buildIndexNowPayload({ origin, key: KEY, urls: [`${origin}/tr`, `${origin}/tr`, 'https://other.example.com/tr', 'https://zen.example.com.evil.test/tr', `${origin}`] });
    expect(payload?.urlList).toEqual([`${origin}/tr`, origin]);
  });

  it('returns null for a bad key, a bad origin or no usable URL', () => {
    expect(buildIndexNowPayload({ origin, key: 'nothex', urls: [`${origin}/tr`] })).toBeNull();
    expect(buildIndexNowPayload({ origin: 'zen.example.com', key: KEY, urls: ['zen.example.com/tr'] })).toBeNull();
    expect(buildIndexNowPayload({ origin, key: KEY, urls: ['https://other.example.com/tr'] })).toBeNull();
    expect(buildIndexNowPayload({ origin, key: KEY, urls: [] })).toBeNull();
  });

  it('lists the URLs of a page and of an article', () => {
    expect(indexNowUrlsForPage(origin, [{ locale: 'tr', slug: '' }, { locale: 'en', slug: 'pricing' }])).toEqual([`${origin}/tr`, `${origin}/en/pricing`]);
    expect(indexNowUrlsForArticle(origin, [{ locale: 'tr', slug: 'ilk-yazi' }, { locale: 'en', slug: 'first-post' }])).toEqual([
      `${origin}/tr/blog/ilk-yazi`,
      `${origin}/en/blog/first-post`,
      `${origin}/tr/blog`,
      `${origin}/en/blog`,
    ]);
  });

  it('allows the plain http origin of local development', () => {
    expect(buildIndexNowPayload({ origin: 'http://localhost:3000', key: KEY, urls: ['http://localhost:3000/tr'] })?.host).toBe('localhost:3000');
  });
});
