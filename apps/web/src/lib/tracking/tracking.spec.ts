import { decide, initialConsent, parseConsent, serializeConsent } from './consent';
import { resolveConsentRegion } from './region';
import { buildTouchpoint, hasTrackingParams, shouldSendTouchpoint } from './touchpoint';

describe('consent region', () => {
  it('prefers the edge country header', () => {
    expect(resolveConsentRegion({ countryHeader: 'DE', acceptLanguage: 'tr-TR' })).toEqual({ region: 'EU', mode: 'opt_in', source: 'header' });
    expect(resolveConsentRegion({ countryHeader: 'tr' })).toEqual({ region: 'TR', mode: 'kvkk', source: 'header' });
    expect(resolveConsentRegion({ countryHeader: 'US' }).mode).toBe('notice');
    expect(resolveConsentRegion({ countryHeader: 'GB' }).mode).toBe('opt_in');
    expect(resolveConsentRegion({ countryHeader: 'CA' }).mode).toBe('opt_in');
    expect(resolveConsentRegion({ countryHeader: 'JP' })).toEqual({ region: 'DEFAULT', mode: 'notice', source: 'header' });
  });

  it('falls back to the preferred Accept-Language region', () => {
    expect(resolveConsentRegion({ countryHeader: 'XX', acceptLanguage: 'en;q=0.9,tr-TR' })).toEqual({
      region: 'TR',
      mode: 'kvkk',
      source: 'language',
    });
    expect(resolveConsentRegion({ acceptLanguage: 'en-US,en;q=0.8' }).region).toBe('US');
  });

  it('uses the strictest (EU) behaviour when the region is unknown', () => {
    expect(resolveConsentRegion({ acceptLanguage: 'en' })).toEqual({ region: 'EU', mode: 'opt_in', source: 'fallback' });
    expect(resolveConsentRegion({})).toEqual({ region: 'EU', mode: 'opt_in', source: 'fallback' });
  });
});

describe('consent state', () => {
  it('round-trips the stored choice', () => {
    expect(parseConsent(serializeConsent({ analytics: true, advertising: false }))).toEqual({ analytics: true, advertising: false });
    expect(parseConsent('garbage')).toBeNull();
  });

  it('opt-in and KVKK regions start with nothing allowed', () => {
    expect(initialConsent('opt_in', null, false)).toEqual({ analytics: false, advertising: false, decided: false });
    expect(initialConsent('kvkk', null, false)).toEqual({ analytics: false, advertising: false, decided: false });
  });

  it('notice regions track by default and honour Global Privacy Control for advertising', () => {
    expect(initialConsent('notice', null, false)).toEqual({ analytics: true, advertising: true, decided: false });
    expect(initialConsent('notice', null, true)).toEqual({ analytics: true, advertising: false, decided: false });
  });

  it('GPC overrides a stored or clicked advertising consent; advertising needs analytics', () => {
    expect(initialConsent('opt_in', { analytics: true, advertising: true }, true)).toEqual({ analytics: true, advertising: false, decided: true });
    expect(decide({ analytics: true, advertising: true }, true).advertising).toBe(false);
    expect(decide({ analytics: false, advertising: true }, false)).toEqual({ analytics: false, advertising: false, decided: true });
  });
});

describe('touchpoint payload', () => {
  const base = {
    visitorId: '11111111-2222-4333-8444-555555555555',
    sessionId: '66666666-7777-4888-9999-aaaaaaaaaaaa',
    url: 'https://site.example/tr?utm_source=facebook&pw_cid=1&pw_asid=2&fbclid=F1',
    referrer: 'https://l.facebook.com/',
    locale: 'tr',
    fbpCookie: 'fb.1.1.1',
    now: 1_700_000_000_000,
  };

  it('sends once per session and whenever tracking parameters are present', () => {
    expect(shouldSendTouchpoint(true, 'https://site.example/')).toBe(true);
    expect(shouldSendTouchpoint(false, 'https://site.example/')).toBe(false);
    expect(shouldSendTouchpoint(false, 'https://site.example/?gclid=1')).toBe(true);
    expect(hasTrackingParams('https://site.example/?q=search')).toBe(false);
  });

  it('includes click ids and Meta cookies only with advertising consent', () => {
    const ads = buildTouchpoint({ ...base, consent: { analytics: true, advertising: true } });
    expect(ads.clickIds.fbclid).toBe('F1');
    expect(ads.fbp).toBe('fb.1.1.1');
    expect(ads.fbc).toBe('fb.1.1700000000000.F1');
    const noAds = buildTouchpoint({ ...base, consent: { analytics: true, advertising: false } });
    expect(noAds.clickIds).toEqual({});
    expect(noAds.fbp).toBeUndefined();
    expect(noAds.fbc).toBeUndefined();
    expect(noAds.utm.utm_source).toBe('facebook');
    expect(noAds.adIds).toEqual({ pw_cid: '1', pw_asid: '2' });
    expect(noAds.consent).toEqual({ analytics: true, advertising: false });
    expect(noAds.ref).toBeUndefined();
  });

  it('carries a well-formed business referral code without advertising consent', () => {
    expect(shouldSendTouchpoint(false, 'https://site.example/tr?pw_ref=K3F7QANB')).toBe(true);
    const tp = buildTouchpoint({ ...base, url: 'https://site.example/tr?pw_ref=k3f7qanb', consent: { analytics: true, advertising: false } });
    expect(tp.ref).toBe('K3F7QANB');
    const bad = buildTouchpoint({ ...base, url: 'https://site.example/tr?pw_ref=<x>', consent: { analytics: true, advertising: false } });
    expect(bad.ref).toBeUndefined();
  });
});
