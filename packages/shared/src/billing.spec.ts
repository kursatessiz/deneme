import {
  ActivateStudioSchema,
  AdminForceBillingStatusSchema,
  AdminSetBillingCurrencySchema,
  DEFAULT_REFERRAL_REWARD,
  PLATFORM_BILLING_CURRENCIES,
  ReferralRewardSettingSchema,
  STUDIO_BILLING_STATUSES,
  TRANSLATED_API_ERROR_CODES,
  applyCredits,
  canTransitionBillingStatus,
  creditBalanceOf,
  dueTrialReminder,
  isAllowedWhenRestricted,
  isSelfReferral,
  isTrialExpired,
  isWriteRestricted,
  parseReferralParam,
  planPriceIn,
  platformBillingCurrencyOf,
  referralRewardEntry,
  studioBillingCurrency,
  trialDaysLeft,
  trialEndFrom,
} from './billing';
import { CreateTenantSchema, UpsertPlanSchema } from './admin';
import { OWNER_ONLY_PERMISSIONS, resolvePermissions } from './permissions';
import { BASE_MESSAGES } from './i18n/messages';
import { TouchpointInputSchema } from './growth/attribution';

const NOW = new Date('2026-10-10T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('trial', () => {
  it('ends trialDays after the start', () => {
    expect(trialEndFrom(NOW, 14).toISOString()).toBe(at(14).toISOString());
    expect(trialEndFrom(NOW, 0).toISOString()).toBe(NOW.toISOString());
  });

  it('counts days left rounded up and never negative', () => {
    expect(trialDaysLeft(at(14), NOW)).toBe(14);
    expect(trialDaysLeft(at(13.2), NOW)).toBe(14);
    expect(trialDaysLeft(at(0.1), NOW)).toBe(1);
    expect(trialDaysLeft(at(-3), NOW)).toBe(0);
    expect(trialDaysLeft(at(2).toISOString(), NOW)).toBe(2);
    expect(trialDaysLeft(null, NOW)).toBeNull();
  });

  it('is expired at or after the end', () => {
    expect(isTrialExpired(at(0), NOW)).toBe(true);
    expect(isTrialExpired(at(-1), NOW)).toBe(true);
    expect(isTrialExpired(at(1), NOW)).toBe(false);
    expect(isTrialExpired(null, NOW)).toBe(false);
  });

  it('sends 7, 3 and 1 day reminders once each, only the most urgent when late', () => {
    expect(dueTrialReminder(10, null)).toBeNull();
    expect(dueTrialReminder(7, null)).toBe(7);
    expect(dueTrialReminder(6, 7)).toBeNull();
    expect(dueTrialReminder(3, 7)).toBe(3);
    expect(dueTrialReminder(3, 3)).toBeNull();
    expect(dueTrialReminder(1, 3)).toBe(1);
    expect(dueTrialReminder(1, 1)).toBeNull();
    // A heartbeat that first sees the trial with 2 days left skips the 7-day notice.
    expect(dueTrialReminder(2, null)).toBe(3);
    expect(dueTrialReminder(0, null)).toBeNull();
    expect(dueTrialReminder(null, null)).toBeNull();
  });
});

describe('billing status', () => {
  it('allows only the documented transitions', () => {
    expect(canTransitionBillingStatus('TRIALING', 'ACTIVE')).toBe(true);
    expect(canTransitionBillingStatus('TRIALING', 'RESTRICTED')).toBe(true);
    expect(canTransitionBillingStatus('RESTRICTED', 'ACTIVE')).toBe(true);
    expect(canTransitionBillingStatus('RESTRICTED', 'TRIALING')).toBe(true);
    expect(canTransitionBillingStatus('ACTIVE', 'TRIALING')).toBe(false);
    expect(canTransitionBillingStatus('ACTIVE', 'PAST_DUE')).toBe(true);
    expect(canTransitionBillingStatus('CANCELLED', 'RESTRICTED')).toBe(false);
    expect(canTransitionBillingStatus('CANCELLED', 'ACTIVE')).toBe(true);
    for (const s of STUDIO_BILLING_STATUSES) expect(canTransitionBillingStatus(s, s)).toBe(false);
  });

  it('restricts writes only when RESTRICTED or CANCELLED', () => {
    expect(isWriteRestricted('RESTRICTED')).toBe(true);
    expect(isWriteRestricted('CANCELLED')).toBe(true);
    for (const s of ['TRIALING', 'ACTIVE', 'PAST_DUE', undefined, null]) expect(isWriteRestricted(s)).toBe(false);
  });

  it('keeps billing, settings, roles, staff and exports writable in restricted mode, nothing else', () => {
    expect(isAllowedWhenRestricted(['billing.manage'])).toBe(true);
    expect(isAllowedWhenRestricted(['crm.export'])).toBe(true);
    expect(isAllowedWhenRestricted(['staff.manage'])).toBe(true);
    expect(isAllowedWhenRestricted(['bookings.manage'])).toBe(false);
    expect(isAllowedWhenRestricted(['retail.sell'])).toBe(false);
    expect(isAllowedWhenRestricted(['campaigns.manage'])).toBe(false);
    expect(isAllowedWhenRestricted(['schedule.manage'])).toBe(false);
    // Every required permission must be on the list; none (self-service) is not enough.
    expect(isAllowedWhenRestricted(['crm.export', 'crm.manage'])).toBe(false);
    expect(isAllowedWhenRestricted([])).toBe(false);
  });

  it('billing.manage is owner only', () => {
    expect(OWNER_ONLY_PERMISSIONS).toContain('billing.manage');
    expect(resolvePermissions({ isOwner: false, permissions: ['billing.manage', 'members.view'] })).toEqual(['members.view']);
    expect(resolvePermissions({ isOwner: true, permissions: [] })).toContain('billing.manage');
  });

  it('the restricted error code has a Turkish translation', () => {
    const key = TRANSLATED_API_ERROR_CODES.BILLING_RESTRICTED;
    expect(BASE_MESSAGES[key]).toBeTruthy();
  });
});

describe('referral reward and credits', () => {
  it('validates the reward setting', () => {
    expect(ReferralRewardSettingSchema.safeParse({ kind: 'FREE_MONTHS', months: 1 }).success).toBe(true);
    expect(ReferralRewardSettingSchema.safeParse({ kind: 'FREE_MONTHS', months: 0 }).success).toBe(false);
    expect(ReferralRewardSettingSchema.safeParse({ kind: 'AMOUNT', amounts: [{ currency: 'TRY', amount: '500.00' }] }).success).toBe(true);
    expect(ReferralRewardSettingSchema.safeParse({ kind: 'AMOUNT', amounts: [] }).success).toBe(false);
    expect(ReferralRewardSettingSchema.safeParse({ kind: 'AMOUNT', amounts: [{ currency: 'EUR', amount: '-5' }] }).success).toBe(false);
    // Only platform billing currencies, each once.
    expect(ReferralRewardSettingSchema.safeParse({ kind: 'AMOUNT', amounts: [{ currency: 'GBP', amount: '5.00' }] }).success).toBe(true);
    expect(ReferralRewardSettingSchema.safeParse({ kind: 'AMOUNT', amounts: [{ currency: 'CHF', amount: '5.00' }] }).success).toBe(false);
    expect(
      ReferralRewardSettingSchema.safeParse({ kind: 'AMOUNT', amounts: [{ currency: 'EUR', amount: '5.00' }, { currency: 'EUR', amount: '6.00' }] }).success,
    ).toBe(false);
  });

  it('the default reward is one free month (owner decision)', () => {
    expect(DEFAULT_REFERRAL_REWARD).toEqual({ kind: 'FREE_MONTHS', months: 1 });
  });

  it('turns the setting into one ledger entry in the referrer billing currency', () => {
    expect(referralRewardEntry({ kind: 'FREE_MONTHS', months: 2 }, 'TRY')).toEqual({ amount: null, currency: null, months: 2 });
    const amounts = { kind: 'AMOUNT' as const, amounts: [{ currency: 'EUR' as const, amount: '25.50' }, { currency: 'TRY' as const, amount: '900.00' }] };
    expect(referralRewardEntry(amounts, 'EUR')).toEqual({ amount: '25.50', currency: 'EUR', months: null });
    expect(referralRewardEntry(amounts, 'TRY')).toEqual({ amount: '900.00', currency: 'TRY', months: null });
    // No amount in the referrer's currency: never converted, the default applies.
    expect(referralRewardEntry(amounts, 'USD')).toEqual({ amount: null, currency: null, months: 1 });
  });

  it('sums a signed ledger per currency and in months', () => {
    const balance = creditBalanceOf([
      { amount: '500.00', currency: 'TRY', months: null },
      { amount: '-120.25', currency: 'TRY', months: null },
      { amount: '10.00', currency: 'EUR', months: null },
      { amount: null, currency: null, months: 2 },
      { amount: null, currency: null, months: -1 },
      { amount: '-10.00', currency: 'USD', months: null },
    ]);
    expect(balance).toEqual({ amounts: [{ currency: 'EUR', amount: '10.00' }, { currency: 'TRY', amount: '379.75' }], months: 1 });
  });

  it('uses free months first, then same-currency money, never another currency', () => {
    const charge = { amount: '1490.00', currency: 'TRY', periodMonths: 1 };
    expect(applyCredits(charge, { amounts: [], months: 0 })).toEqual({ payable: '1490.00', creditAmount: '0.00', creditMonths: 0 });
    expect(applyCredits(charge, { amounts: [{ currency: 'TRY', amount: '500.00' }], months: 1 })).toEqual({
      payable: '0.00',
      creditAmount: '0.00',
      creditMonths: 1,
    });
    expect(applyCredits(charge, { amounts: [{ currency: 'TRY', amount: '500.00' }], months: 0 })).toEqual({
      payable: '990.00',
      creditAmount: '500.00',
      creditMonths: 0,
    });
    expect(applyCredits(charge, { amounts: [{ currency: 'TRY', amount: '2000.00' }], months: 0 })).toEqual({
      payable: '0.00',
      creditAmount: '1490.00',
      creditMonths: 0,
    });
    expect(applyCredits(charge, { amounts: [{ currency: 'EUR', amount: '100.00' }], months: 0 }).payable).toBe('1490.00');
  });
});

describe('business referrals', () => {
  it('reads pw_ref from a landing URL', () => {
    expect(parseReferralParam('https://site.example/tr?pw_ref=k3f7qanb&utm_source=x')).toBe('K3F7QANB');
    expect(parseReferralParam('https://site.example/tr?utm_source=x&pw_ref=K3F7QANB#top')).toBe('K3F7QANB');
    expect(parseReferralParam('https://site.example/tr?pw_ref=BAD')).toBeNull();
    expect(parseReferralParam('https://site.example/tr?ref=K3F7QANB')).toBeNull();
    expect(parseReferralParam('https://site.example/tr?pw_ref=%E0%A4%A')).toBeNull();
  });

  it('detects self-referral by studio, owner phone or email', () => {
    const referrer = { studioId: 'a', ownerPhones: ['+905320000001'], ownerEmails: ['Owner@Example.com'] };
    expect(isSelfReferral(referrer, { studioId: 'a', ownerPhones: [], ownerEmails: [] })).toBe(true);
    expect(isSelfReferral(referrer, { studioId: 'b', ownerPhones: ['+905320000001'], ownerEmails: [] })).toBe(true);
    expect(isSelfReferral(referrer, { studioId: 'b', ownerPhones: ['+905320000009'], ownerEmails: ['owner@example.com '] })).toBe(true);
    expect(isSelfReferral(referrer, { studioId: 'b', ownerPhones: ['+905320000009'], ownerEmails: [null] })).toBe(false);
  });

  it('accepts an optional referral code on tenant creation and in the touchpoint contract', () => {
    const base = {
      name: 'Yeni',
      slug: 'yeni-isletme',
      businessTypeTemplateKey: 'x',
      planKey: 'starter',
      countryCode: 'TR',
      ownerFirstName: 'A',
      ownerLastName: 'B',
      ownerPhone: '05321234567',
    };
    expect(CreateTenantSchema.parse({ ...base, referralCode: '' }).referralCode).toBeUndefined();
    expect(CreateTenantSchema.parse({ ...base, referralCode: 'zenref23' }).referralCode).toBe('ZENREF23');
    expect(CreateTenantSchema.safeParse({ ...base, referralCode: 'nope' }).success).toBe(false);
    const tp = TouchpointInputSchema.safeParse({
      visitorId: '11111111-2222-4333-8444-555555555555',
      sessionId: '66666666-7777-4888-9999-aaaaaaaaaaaa',
      landingUrl: 'https://site.example/tr?pw_ref=ZENREF23',
      utm: {},
      adIds: {},
      clickIds: {},
      ref: 'ZENREF23',
      consent: { analytics: true, advertising: false },
    });
    expect(tp.success).toBe(true);
  });

  it('plans carry prices per billing currency and a trial length; activation needs a plan', () => {
    const plan = UpsertPlanSchema.parse({ key: 'p', name: 'P', prices: [{ currency: 'EUR', priceMonthly: 10 }, { currency: 'TRY', priceMonthly: 390 }], trialDays: 21 });
    expect(plan.prices).toHaveLength(2);
    expect(plan.trialDays).toBe(21);
    expect(UpsertPlanSchema.safeParse({ key: 'p', name: 'P', prices: [{ currency: 'EUR', priceMonthly: 10 }], trialDays: 400 }).success).toBe(false);
    // Deprecated single price still accepted, but only with its currency.
    expect(UpsertPlanSchema.safeParse({ key: 'p', name: 'P', priceMonthly: 10, currency: 'USD' }).success).toBe(true);
    expect(UpsertPlanSchema.safeParse({ key: 'p', name: 'P', priceMonthly: 10 }).success).toBe(false);
    expect(UpsertPlanSchema.safeParse({ key: 'p', name: 'P', prices: [{ currency: 'GBP', priceMonthly: 10 }] }).success).toBe(true);
    expect(UpsertPlanSchema.safeParse({ key: 'p', name: 'P', prices: [{ currency: 'CHF', priceMonthly: 10 }] }).success).toBe(false);
    expect(
      UpsertPlanSchema.safeParse({ key: 'p', name: 'P', prices: [{ currency: 'TRY', priceMonthly: 1 }, { currency: 'TRY', priceMonthly: 2 }] }).success,
    ).toBe(false);
    expect(ActivateStudioSchema.parse({ planKey: 'starter' }).installmentCount).toBe(1);
    expect(ActivateStudioSchema.safeParse({}).success).toBe(false);
  });
});

describe('platform billing currency (G5c-1b)', () => {
  it('offers TRY, USD and EUR', () => {
    expect(PLATFORM_BILLING_CURRENCIES).toEqual(['TRY', 'USD', 'EUR', 'GBP']);
  });

  it('maps a country to its billing currency', () => {
    expect(platformBillingCurrencyOf('TR')).toBe('TRY');
    expect(platformBillingCurrencyOf('tr')).toBe('TRY');
    for (const euro of ['DE', 'FR', 'NL', 'IT', 'ES', 'AT', 'IE', 'HR', 'BG']) expect(platformBillingCurrencyOf(euro)).toBe('EUR');
    // United Kingdom and the Crown dependencies: GBP (owner decision).
    for (const pound of ['GB', 'GG', 'JE', 'IM']) expect(platformBillingCurrencyOf(pound)).toBe('GBP');
    // EU but not euro area, and everything else: USD.
    for (const other of ['PL', 'SE', 'DK', 'CH', 'US', 'CA', 'AE', 'SA']) expect(platformBillingCurrencyOf(other)).toBe('USD');
    expect(platformBillingCurrencyOf(null)).toBe('USD');
  });

  it('a super-admin override wins over the country', () => {
    expect(studioBillingCurrency({ countryCode: 'TR', billingCurrency: null })).toBe('TRY');
    expect(studioBillingCurrency({ countryCode: 'TR', billingCurrency: 'EUR' })).toBe('EUR');
    // An override no longer offered is ignored.
    expect(studioBillingCurrency({ countryCode: 'DE', billingCurrency: 'CHF' })).toBe('EUR');
  });

  it('finds a plan price only in the same currency', () => {
    const prices = [{ currency: 'TRY', priceMonthly: '1490.00' }, { currency: 'EUR', priceMonthly: '45.00' }];
    expect(planPriceIn(prices, 'EUR')?.priceMonthly).toBe('45.00');
    expect(planPriceIn(prices, 'USD')).toBeNull();
  });

  it('force activation records a payment only when asked, and the override accepts null', () => {
    expect(AdminForceBillingStatusSchema.parse({ status: 'ACTIVE' }).recordAsPaid).toBe(false);
    expect(AdminForceBillingStatusSchema.parse({ status: 'ACTIVE', recordAsPaid: true }).recordAsPaid).toBe(true);
    expect(AdminSetBillingCurrencySchema.safeParse({ currency: null }).success).toBe(true);
    expect(AdminSetBillingCurrencySchema.safeParse({ currency: 'USD' }).success).toBe(true);
    expect(AdminSetBillingCurrencySchema.safeParse({ currency: 'GBP' }).success).toBe(true);
    expect(AdminSetBillingCurrencySchema.safeParse({ currency: 'CHF' }).success).toBe(false);
  });

  it('translates the new billing error codes', () => {
    expect(TRANSLATED_API_ERROR_CODES.BILLING_CURRENCY_LOCKED).toBe('billing.error.BILLING_CURRENCY_LOCKED');
    expect(TRANSLATED_API_ERROR_CODES.PLAN_PRICE_UNAVAILABLE).toBe('billing.error.PLAN_PRICE_UNAVAILABLE');
    expect(BASE_MESSAGES['billing.error.BILLING_CURRENCY_LOCKED']).toBeTruthy();
    expect(BASE_MESSAGES['billing.error.PLAN_PRICE_UNAVAILABLE']).toBeTruthy();
  });
});
