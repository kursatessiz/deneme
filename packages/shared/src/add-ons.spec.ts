import {
  ADD_ON_DUNNING_RETRY_DAYS,
  ActivateAddOnSchema,
  CreateAddOnSchema,
  SetAddOnPricesSchema,
  UpdateAddOnSchema,
  addOnHasAccess,
  addOnPeriodEnd,
  addOnPriceIn,
  buildAddOnSnapshot,
  dueAddOnExpiry,
  isAddOnRenewalDue,
  isAddOnTrialReminderDue,
  localizedText,
  nextDunningAttempt,
  parseAddOnSnapshot,
  resolveEffectiveFeature,
} from './add-ons';
import { TRANSLATED_API_ERROR_CODES } from './billing';
import { ADD_ON_ERROR_CODES } from './add-on-errors';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-30T12:00:00.000Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('effective feature resolution with add-on layering', () => {
  const base = { tenant: null, addOnEntitled: false, businessType: null, global: null };

  it('is off when no scope has a row and there is no add-on', () => {
    expect(resolveEffectiveFeature(base)).toBe(false);
  });

  it('an entitling add-on turns the feature on when the other scopes are silent or off', () => {
    expect(resolveEffectiveFeature({ ...base, addOnEntitled: true })).toBe(true);
    expect(resolveEffectiveFeature({ ...base, addOnEntitled: true, businessType: false, global: false })).toBe(true);
  });

  it('an explicit TENANT row wins over the add-on in both directions (super admin kill switch)', () => {
    expect(resolveEffectiveFeature({ ...base, tenant: false, addOnEntitled: true })).toBe(false);
    expect(resolveEffectiveFeature({ ...base, tenant: true })).toBe(true);
  });

  it('keeps the existing order without an add-on: BUSINESS_TYPE over GLOBAL, most specific wins', () => {
    expect(resolveEffectiveFeature({ ...base, businessType: false, global: true })).toBe(false);
    expect(resolveEffectiveFeature({ ...base, businessType: true, global: false })).toBe(true);
    expect(resolveEffectiveFeature({ ...base, global: true })).toBe(true);
  });

  it('an add-on never disables a feature another scope enables', () => {
    expect(resolveEffectiveFeature({ ...base, global: true, addOnEntitled: false })).toBe(true);
  });
});

describe('add-on access and expiry math', () => {
  it('TRIALING has access only before the trial end', () => {
    expect(addOnHasAccess({ status: 'TRIALING', trialEndsAt: at(1), currentPeriodEnd: null }, NOW)).toBe(true);
    expect(addOnHasAccess({ status: 'TRIALING', trialEndsAt: at(0), currentPeriodEnd: null }, NOW)).toBe(false);
    expect(addOnHasAccess({ status: 'TRIALING', trialEndsAt: at(-1), currentPeriodEnd: null }, NOW)).toBe(false);
    expect(addOnHasAccess({ status: 'TRIALING', trialEndsAt: null, currentPeriodEnd: null }, NOW)).toBe(false);
  });

  it('ACTIVE always has access (retries of a failed renewal keep it on until the heartbeat expires it)', () => {
    expect(addOnHasAccess({ status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: at(-2) }, NOW)).toBe(true);
  });

  it('CANCELLED keeps access until the period end, EXPIRED never', () => {
    expect(addOnHasAccess({ status: 'CANCELLED', trialEndsAt: null, currentPeriodEnd: at(5) }, NOW)).toBe(true);
    expect(addOnHasAccess({ status: 'CANCELLED', trialEndsAt: null, currentPeriodEnd: at(-1) }, NOW)).toBe(false);
    expect(addOnHasAccess({ status: 'CANCELLED', trialEndsAt: null, currentPeriodEnd: null }, NOW)).toBe(false);
    expect(addOnHasAccess({ status: 'EXPIRED', trialEndsAt: at(9), currentPeriodEnd: at(9) }, NOW)).toBe(false);
  });

  it('accepts ISO strings as dates', () => {
    expect(addOnHasAccess({ status: 'CANCELLED', trialEndsAt: null, currentPeriodEnd: at(1).toISOString() }, NOW)).toBe(true);
  });

  it('the heartbeat expires an ended trial and an ended cancelled period, nothing else', () => {
    expect(dueAddOnExpiry({ status: 'TRIALING', trialEndsAt: at(-1), currentPeriodEnd: null }, NOW)).toBe('TRIAL_ENDED');
    expect(dueAddOnExpiry({ status: 'TRIALING', trialEndsAt: at(1), currentPeriodEnd: null }, NOW)).toBeNull();
    expect(dueAddOnExpiry({ status: 'CANCELLED', trialEndsAt: null, currentPeriodEnd: at(-1) }, NOW)).toBe('CANCELLED_PERIOD_ENDED');
    expect(dueAddOnExpiry({ status: 'CANCELLED', trialEndsAt: null, currentPeriodEnd: at(1) }, NOW)).toBeNull();
    expect(dueAddOnExpiry({ status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: at(-1) }, NOW)).toBeNull();
    expect(dueAddOnExpiry({ status: 'EXPIRED', trialEndsAt: null, currentPeriodEnd: at(-1) }, NOW)).toBeNull();
  });

  it('a renewal is due for an ACTIVE row past its period end and past its retry time', () => {
    expect(isAddOnRenewalDue({ status: 'ACTIVE', currentPeriodEnd: at(-1) }, NOW)).toBe(true);
    expect(isAddOnRenewalDue({ status: 'ACTIVE', currentPeriodEnd: at(1) }, NOW)).toBe(false);
    expect(isAddOnRenewalDue({ status: 'ACTIVE', currentPeriodEnd: at(-3), nextRenewalAttemptAt: at(1) }, NOW)).toBe(false);
    expect(isAddOnRenewalDue({ status: 'ACTIVE', currentPeriodEnd: at(-3), nextRenewalAttemptAt: at(-1) }, NOW)).toBe(true);
    expect(isAddOnRenewalDue({ status: 'CANCELLED', currentPeriodEnd: at(-1) }, NOW)).toBe(false);
  });

  it('period end adds calendar months and clamps the day', () => {
    expect(addOnPeriodEnd(new Date('2026-01-31T10:00:00.000Z'), 'MONTH').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addOnPeriodEnd(new Date('2026-10-30T12:00:00.000Z'), 'MONTH').toISOString()).toBe('2026-11-30T12:00:00.000Z');
    expect(addOnPeriodEnd(new Date('2026-10-30T12:00:00.000Z'), 'YEAR').toISOString()).toBe('2027-10-30T12:00:00.000Z');
    expect(addOnPeriodEnd(new Date('2028-02-29T00:00:00.000Z'), 'YEAR').toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });
});

describe('dunning and trial reminder', () => {
  it('retries after 1, 3 and 5 days and gives up after the fourth failure', () => {
    expect(ADD_ON_DUNNING_RETRY_DAYS).toEqual([1, 3, 5]);
    expect(nextDunningAttempt(1, NOW)?.getTime()).toBe(at(1).getTime());
    expect(nextDunningAttempt(2, NOW)?.getTime()).toBe(at(3).getTime());
    expect(nextDunningAttempt(3, NOW)?.getTime()).toBe(at(5).getTime());
    expect(nextDunningAttempt(4, NOW)).toBeNull();
  });

  it('the trial notice is due within 3 days of the end, once', () => {
    const row = (days: number, sent: Date | null) => ({ status: 'TRIALING', trialEndsAt: at(days), trialReminderSentAt: sent });
    expect(isAddOnTrialReminderDue(row(3, null), NOW)).toBe(true);
    expect(isAddOnTrialReminderDue(row(2, null), NOW)).toBe(true);
    expect(isAddOnTrialReminderDue(row(4, null), NOW)).toBe(false);
    expect(isAddOnTrialReminderDue(row(2, at(-1)), NOW)).toBe(false);
    expect(isAddOnTrialReminderDue(row(-1, null), NOW)).toBe(false);
    expect(isAddOnTrialReminderDue({ status: 'ACTIVE', trialEndsAt: at(2), trialReminderSentAt: null }, NOW)).toBe(false);
  });
});

describe('price lookup by currency and snapshot', () => {
  const prices = [
    { currency: 'TRY', priceMonthly: '199.00', priceYearly: '1990.00' },
    { currency: 'EUR', priceMonthly: '9.00', priceYearly: '90.00' },
  ] as const;

  it('finds the price in the tenant currency and returns null when there is none', () => {
    expect(addOnPriceIn(prices, 'EUR')?.priceYearly).toBe('90.00');
    expect(addOnPriceIn(prices, 'USD')).toBeNull();
    expect(addOnPriceIn([], 'TRY')).toBeNull();
  });

  it('the snapshot keeps the currency and the chosen interval amount', () => {
    const price = { currency: 'EUR', priceMonthly: '9.00', priceYearly: '90.00' } as const;
    expect(buildAddOnSnapshot(price, null)).toEqual({ currency: 'EUR', priceMonthly: '9.00', priceYearly: '90.00', interval: null, amount: null });
    expect(buildAddOnSnapshot(price, 'MONTH').amount).toBe('9.00');
    expect(buildAddOnSnapshot(price, 'YEAR').amount).toBe('90.00');
  });

  it('parses a stored snapshot and rejects garbage', () => {
    const snap = buildAddOnSnapshot({ currency: 'TRY', priceMonthly: '1.00', priceYearly: '10.00' }, 'YEAR');
    expect(parseAddOnSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
    expect(parseAddOnSnapshot(null)).toBeNull();
    expect(parseAddOnSnapshot({ currency: 1 })).toBeNull();
    expect(parseAddOnSnapshot('x')).toBeNull();
  });
});

describe('per-locale text fallback', () => {
  const text = { tr: 'Uygulama', en: 'App', de: 'Anwendung' };

  it('uses the exact locale, then the language, then English, then Turkish', () => {
    expect(localizedText(text, 'de')).toBe('Anwendung');
    expect(localizedText(text, 'de-AT')).toBe('Anwendung');
    expect(localizedText(text, 'fr')).toBe('App');
    expect(localizedText({ tr: 'Uygulama' }, 'fr')).toBe('Uygulama');
    expect(localizedText({ tr: 'Uygulama', en: '  ' }, 'en')).toBe('Uygulama');
  });

  it('falls back to any non-empty value and never throws', () => {
    expect(localizedText({ ja: 'アプリ' }, 'fr')).toBe('アプリ');
    expect(localizedText({}, 'en')).toBe('');
    expect(localizedText(null, 'en')).toBe('');
  });
});

describe('add-on schemas', () => {
  const valid = {
    key: 'video-pro',
    name: { tr: 'Video Pro', en: 'Video Pro' },
    description: { tr: 'Aciklama', en: 'Description' },
    featureFlagKey: 'video_content',
  };

  it('creates with defaults and requires both tr and en text', () => {
    const parsed = CreateAddOnSchema.parse(valid);
    expect(parsed).toMatchObject({ trialDays: 14, isPublished: false, sortOrder: 0, screenshotUrls: [], promoVideoUrl: null });
    expect(CreateAddOnSchema.safeParse({ ...valid, name: { tr: 'Sadece' } }).success).toBe(false);
    expect(CreateAddOnSchema.safeParse({ ...valid, key: 'Bad Key' }).success).toBe(false);
    expect(CreateAddOnSchema.safeParse({ ...valid, promoVideoUrl: 'http://insecure.example/v' }).success).toBe(false);
    expect(CreateAddOnSchema.safeParse({ ...valid, trialDays: 91 }).success).toBe(false);
    expect(CreateAddOnSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });

  it('accepts additional locales next to tr and en', () => {
    expect(CreateAddOnSchema.safeParse({ ...valid, name: { tr: 'a', en: 'b', de: 'c' } }).success).toBe(true);
    expect(CreateAddOnSchema.safeParse({ ...valid, name: { tr: 'a', en: 'b', 'not a locale': 'c' } }).success).toBe(false);
  });

  it('update is partial and does not take a key', () => {
    expect(UpdateAddOnSchema.safeParse({ isPublished: true }).success).toBe(true);
    expect(UpdateAddOnSchema.safeParse({ key: 'other' }).success).toBe(false);
  });

  it('prices: platform currencies only, positive two-decimal amounts, one per currency', () => {
    expect(SetAddOnPricesSchema.safeParse({ prices: [{ currency: 'TRY', priceMonthly: 199, priceYearly: 1990 }] }).success).toBe(true);
    expect(SetAddOnPricesSchema.safeParse({ prices: [{ currency: 'CHF', priceMonthly: 9, priceYearly: 90 }] }).success).toBe(false);
    expect(SetAddOnPricesSchema.safeParse({ prices: [{ currency: 'EUR', priceMonthly: 0, priceYearly: 90 }] }).success).toBe(false);
    expect(SetAddOnPricesSchema.safeParse({ prices: [{ currency: 'EUR', priceMonthly: 9.999, priceYearly: 90 }] }).success).toBe(false);
    expect(
      SetAddOnPricesSchema.safeParse({
        prices: [
          { currency: 'EUR', priceMonthly: 9, priceYearly: 90 },
          { currency: 'EUR', priceMonthly: 8, priceYearly: 80 },
        ],
      }).success,
    ).toBe(false);
    expect(SetAddOnPricesSchema.safeParse({ prices: [] }).success).toBe(true);
  });

  it('activation needs an interval', () => {
    expect(ActivateAddOnSchema.safeParse({ interval: 'YEAR' }).success).toBe(true);
    expect(ActivateAddOnSchema.safeParse({}).success).toBe(false);
    expect(ActivateAddOnSchema.safeParse({ interval: 'WEEK' }).success).toBe(false);
  });
});

describe('add-on API error translation', () => {
  it('every add-on error code has a translation key', () => {
    for (const code of Object.values(ADD_ON_ERROR_CODES)) {
      expect(TRANSLATED_API_ERROR_CODES[code]).toBe(`addOns.error.${code}`);
    }
  });
});
