import { creditConversion, pickFirstTouch, pickLastTouch, touchSource, touchesInWindow } from './attribution-models';
import type { TouchLike, TouchSummary } from './attribution-models';

const DAY = 24 * 60 * 60 * 1000;
const AT = new Date('2026-09-28T12:00:00Z');

function touch(id: string, daysBefore: number, fields: Partial<TouchLike> = {}): TouchLike {
  return {
    id,
    occurredAt: new Date(AT.getTime() - daysBefore * DAY),
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmId: null,
    pwCid: null,
    pwAsid: null,
    pwAdid: null,
    adPlatform: null,
    referrerHost: null,
    ...fields,
  };
}

const META = touch('meta', 40, { utmSource: 'facebook', pwCid: 'c-meta', pwAsid: 'as-meta', pwAdid: 'ad-meta' });
const GOOGLE = touch('google', 10, { utmSource: 'google', pwCid: 'c-google', pwAsid: 'as-google', pwAdid: 'ad-google' });
const DIRECT = touch('direct', 2);
const FUTURE = touch('future', -1, { utmSource: 'tiktok' });

describe('attribution windows', () => {
  it('keeps only touches at or before the event and inside the window', () => {
    const inWindow = touchesInWindow([META, GOOGLE, DIRECT, FUTURE], AT, 30);
    expect(inWindow.map((t) => t.id)).toEqual(['google', 'direct']);
  });

  it('includes a touch exactly on the window edge', () => {
    const edge = touch('edge', 30, { utmSource: 'edge' });
    expect(touchesInWindow([edge], AT, 30).map((t) => t.id)).toEqual(['edge']);
  });

  it('last touch is the most recent one inside the window', () => {
    expect(pickLastTouch([META, GOOGLE, DIRECT, FUTURE], AT, 30)?.id).toBe('direct');
    expect(pickLastTouch([META], AT, 30)).toBeNull();
  });

  it('first touch ignores the window but never looks after the event', () => {
    expect(pickFirstTouch([GOOGLE, META, FUTURE], AT)?.id).toBe('meta');
    expect(pickFirstTouch([FUTURE], AT)).toBeNull();
  });

  it('labels the source from utm, ad platform, referrer, then direct', () => {
    expect(touchSource(touch('a', 1, { utmSource: 'newsletter', adPlatform: 'META' }))).toBe('newsletter');
    expect(touchSource(touch('b', 1, { adPlatform: 'GOOGLE' }))).toBe('google');
    expect(touchSource(touch('c', 1, { referrerHost: 'blog.example.com' }))).toBe('blog.example.com');
    expect(touchSource(touch('d', 1))).toBe('(direct)');
  });
});

describe('attribution models', () => {
  const base = { at: AT, windowDays: 30, firstSummary: null, lastSummary: null };

  it('FIRST_TOUCH credits the earliest touch even outside the window', () => {
    expect(creditConversion('FIRST_TOUCH', { ...base, touches: [GOOGLE, META, DIRECT] }, 'campaign')).toEqual([
      { key: 'c-meta', weight: 1 },
    ]);
  });

  it('LAST_TOUCH credits the latest touch in the window', () => {
    expect(creditConversion('LAST_TOUCH', { ...base, touches: [META, GOOGLE] }, 'source')).toEqual([
      { key: 'google', weight: 1 },
    ]);
  });

  it('LAST_TOUCH is direct when the only touch expired', () => {
    expect(creditConversion('LAST_TOUCH', { ...base, touches: [META] }, 'source')).toEqual([{ key: '(direct)', weight: 1 }]);
    expect(creditConversion('LAST_TOUCH', { ...base, touches: [META] }, 'ad')).toEqual([{ key: '(none)', weight: 1 }]);
  });

  it('LINEAR splits the credit equally across touches in the window', () => {
    const credits = creditConversion('LINEAR', { ...base, touches: [META, GOOGLE, DIRECT] }, 'source');
    expect(credits).toHaveLength(2);
    expect(credits.find((c) => c.key === 'google')?.weight).toBeCloseTo(0.5);
    expect(credits.find((c) => c.key === '(direct)')?.weight).toBeCloseTo(0.5);
  });

  it('LINEAR adds up shares of the same key', () => {
    const again = touch('google2', 5, { utmSource: 'google', pwCid: 'c-google' });
    const credits = creditConversion('LINEAR', { ...base, touches: [GOOGLE, again, DIRECT] }, 'source');
    expect(credits.find((c) => c.key === 'google')?.weight).toBeCloseTo(2 / 3);
    expect(credits.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1);
  });

  it('a contact without touchpoints falls back to its stored summary (migrated leads)', () => {
    const summary: TouchSummary = {
      source: 'instagram',
      medium: 'paid_social',
      campaignName: 'tr_tr_pilates_lead_202609',
      campaignId: null,
      adsetId: null,
      adId: null,
    };
    const input = { ...base, touches: [], firstSummary: summary, lastSummary: summary };
    expect(creditConversion('LAST_TOUCH', input, 'source')).toEqual([{ key: 'instagram', weight: 1 }]);
    expect(creditConversion('FIRST_TOUCH', input, 'campaign')).toEqual([{ key: 'tr_tr_pilates_lead_202609', weight: 1 }]);
  });

  it('a contact with touchpoints never falls back to the summary', () => {
    const summary: TouchSummary = { source: 'manual', medium: null, campaignName: null, campaignId: null, adsetId: null, adId: null };
    const input = { ...base, touches: [META], firstSummary: summary, lastSummary: summary };
    expect(creditConversion('LAST_TOUCH', input, 'source')).toEqual([{ key: '(direct)', weight: 1 }]);
  });
});
