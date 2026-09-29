import {
  CONSENT_CONFIRMATION_ERROR_CODES,
  CONSENT_CONFIRMATION_TOKEN_PATTERN,
  CONSENT_CONFIRMATION_TRANSLATED_ERRORS,
  CONSENT_INELIGIBILITY_REASONS,
  DEFAULT_DOUBLE_OPT_IN_REGIONS,
  DoubleOptInRegionsSchema,
  REGION_CONSENT_RULES,
  evaluateCommercialEligibility,
  requiresDoubleOptIn,
  type ConsentBasisChannel,
  type ConsentFacts,
  type ConsentLegalBasis,
  type ConsentPolicy,
  type EligibilityInput,
} from './consent';
import { COMPLIANCE_REGIONS, EU_EEA_COUNTRIES, complianceRegionOf, type ComplianceRegion } from '../growth/regions';
import { MESSAGE_SEND_REASON_CODES } from '../messaging-engine';
import { PRECHECK_FINDING_CODES } from './approvals';
import { UpdateMarketingSettingsSchema, MARKETING_SETTINGS_DEFAULTS } from './settings';
import { BASE_MESSAGES, BUNDLED_MESSAGES } from '../i18n/messages';
import { TRANSLATED_API_ERROR_CODES } from '../billing';

const POLICY: ConsentPolicy = { doubleOptInRegions: ['EU', 'UK'], trMerchantExemptionEnabled: false };
const POLICY_EXEMPT: ConsentPolicy = { ...POLICY, trMerchantExemptionEnabled: true };

const none: ConsentFacts = { decision: 'NONE', decidedBy: 'default', legalBasis: null, confirmationRequested: false, confirmed: false };
const granted = (legalBasis: ConsentLegalBasis | null, extra: Partial<ConsentFacts> = {}): ConsentFacts => ({
  decision: 'GRANTED',
  decidedBy: 'contact',
  legalBasis,
  confirmationRequested: false,
  confirmed: false,
  ...extra,
});

function run(partial: Partial<EligibilityInput>): ReturnType<typeof evaluateCommercialEligibility> {
  return evaluateCommercialEligibility({
    region: 'EU',
    channel: 'EMAIL',
    policy: POLICY,
    consent: none,
    optedOut: false,
    isBusiness: false,
    isExistingCustomer: false,
    ...partial,
  });
}
const outcome = (r: ReturnType<typeof evaluateCommercialEligibility>) => (r.eligible ? `OK:${r.basis}` : r.reason);

describe('evaluateCommercialEligibility: matrix', () => {
  const regions: readonly ComplianceRegion[] = COMPLIANCE_REGIONS;

  it('an opt-out beats every basis, confirmation and flag in every region', () => {
    const facts: ConsentFacts[] = [
      none,
      granted(null),
      granted('CONSENT', { confirmationRequested: true, confirmed: true }),
      granted('EXISTING_CUSTOMER'),
      granted('TR_MERCHANT_EXEMPTION'),
      { ...granted('CONSENT'), decidedBy: 'member' },
    ];
    for (const region of regions) {
      for (const consent of facts) {
        for (const policy of [null, POLICY, POLICY_EXEMPT]) {
          const r = run({ region, consent, policy, optedOut: true, isBusiness: true, isExistingCustomer: true });
          expect(outcome(r)).toBe('OPTED_OUT');
        }
      }
    }
  });

  it('an explicit revocation is never overridden by the business or customer status', () => {
    for (const region of regions) {
      const r = run({ region, policy: POLICY_EXEMPT, consent: { ...none, decision: 'REVOKED', decidedBy: 'contact' }, isBusiness: true, isExistingCustomer: true });
      expect(outcome(r)).toBe('CONSENT_REQUIRED');
    }
  });

  it('without a policy (tenants without marketing settings) only a granted consent counts, as before', () => {
    for (const region of regions) {
      expect(outcome(run({ region, policy: null, consent: granted(null) }))).toBe('OK:CONSENT');
      // Pending double opt-in is a platform-policy concept: never evaluated without a policy.
      expect(outcome(run({ region, policy: null, consent: granted('CONSENT', { confirmationRequested: true }) }))).toBe('OK:CONSENT');
      expect(outcome(run({ region, policy: null, consent: none, isBusiness: true, isExistingCustomer: true }))).toBe('CONSENT_REQUIRED');
    }
  });

  it('CONSENT: pending double opt-in until confirmed; legacy rows (null basis) count as confirmed', () => {
    for (const region of regions) {
      expect(outcome(run({ region, consent: granted('CONSENT', { confirmationRequested: true }) }))).toBe('DOUBLE_OPT_IN_PENDING');
      expect(outcome(run({ region, consent: granted('CONSENT', { confirmationRequested: true, confirmed: true }) }))).toBe('OK:CONSENT');
      expect(outcome(run({ region, consent: granted(null) }))).toBe('OK:CONSENT');
      expect(outcome(run({ region, consent: granted('CONSENT') }))).toBe('OK:CONSENT');
    }
  });

  it('the member app consent is explicit and never waits for a confirmation', () => {
    expect(outcome(run({ consent: { ...granted('CONSENT', { confirmationRequested: true }), decidedBy: 'member' } }))).toBe('OK:CONSENT');
  });

  it('EXISTING_CUSTOMER (soft opt-in): EU and UK on e-mail and SMS, US on e-mail only (TCPA), TR, CA and others never', () => {
    const OK = 'OK:EXISTING_CUSTOMER';
    const NO = 'NO_LEGAL_BASIS';
    const expected: Record<ComplianceRegion, Record<ConsentBasisChannel, string>> = {
      EU: { EMAIL: OK, SMS: OK, WHATSAPP: OK },
      UK: { EMAIL: OK, SMS: OK, WHATSAPP: OK },
      US: { EMAIL: OK, SMS: NO, WHATSAPP: NO },
      TR: { EMAIL: NO, SMS: NO, WHATSAPP: NO },
      CA: { EMAIL: NO, SMS: NO, WHATSAPP: NO },
      DEFAULT: { EMAIL: NO, SMS: NO, WHATSAPP: NO },
    };
    for (const region of regions) {
      for (const channel of ['EMAIL', 'SMS', 'WHATSAPP'] as const) {
        // Derived without a row ...
        expect(outcome(run({ region, channel, consent: none, isExistingCustomer: true }))).toBe(expected[region][channel]);
        // ... and recorded on a row.
        expect(outcome(run({ region, channel, consent: granted('EXISTING_CUSTOMER'), isExistingCustomer: true }))).toBe(expected[region][channel]);
        // No longer a customer: the recorded basis lapses.
        expect(outcome(run({ region, channel, consent: granted('EXISTING_CUSTOMER'), isExistingCustomer: false }))).toBe('NO_LEGAL_BASIS');
      }
    }
    const derived = run({ region: 'US', consent: none, isExistingCustomer: true });
    expect(derived.eligible && derived.recorded).toBe(false);
  });

  it('TR_MERCHANT_EXEMPTION: only a business in an exemption region, only while the setting is on', () => {
    for (const region of regions) {
      const exemptRegion = REGION_CONSENT_RULES[region].merchantExemption;
      const off = run({ region, policy: POLICY, consent: none, isBusiness: true });
      const on = run({ region, policy: POLICY_EXEMPT, consent: none, isBusiness: true });
      if (exemptRegion) {
        expect(outcome(off)).toBe('TR_EXEMPTION_DISABLED');
        expect(outcome(on)).toBe('OK:TR_MERCHANT_EXEMPTION');
        expect(on.eligible && on.recorded).toBe(false);
        expect(outcome(run({ region, policy: POLICY_EXEMPT, consent: granted('TR_MERCHANT_EXEMPTION'), isBusiness: true }))).toBe('OK:TR_MERCHANT_EXEMPTION');
        expect(outcome(run({ region, policy: POLICY, consent: granted('TR_MERCHANT_EXEMPTION'), isBusiness: true }))).toBe('TR_EXEMPTION_DISABLED');
        // Not a business (any more): the exemption cannot apply.
        expect(outcome(run({ region, policy: POLICY_EXEMPT, consent: granted('TR_MERCHANT_EXEMPTION'), isBusiness: false }))).toBe('NO_LEGAL_BASIS');
        expect(outcome(run({ region, policy: POLICY_EXEMPT, consent: none, isBusiness: false }))).toBe('CONSENT_REQUIRED');
      } else {
        expect(outcome(on)).toBe('CONSENT_REQUIRED');
        expect(outcome(run({ region, policy: POLICY_EXEMPT, consent: granted('TR_MERCHANT_EXEMPTION'), isBusiness: true }))).toBe('NO_LEGAL_BASIS');
      }
    }
    expect(REGION_CONSENT_RULES.TR.merchantExemption).toBe(true);
  });

  it('an explicit consent of a TR business counts whatever the exemption setting', () => {
    expect(outcome(run({ region: 'TR', policy: POLICY, consent: granted('CONSENT'), isBusiness: true }))).toBe('OK:CONSENT');
  });

  it('no row and no special status: consent required', () => {
    for (const region of regions) expect(outcome(run({ region, consent: none }))).toBe('CONSENT_REQUIRED');
  });
});

describe('double opt-in region list', () => {
  it('defaults to EU and UK as data', () => {
    expect([...DEFAULT_DOUBLE_OPT_IN_REGIONS]).toEqual(['EU', 'UK']);
    expect([...MARKETING_SETTINGS_DEFAULTS.doubleOptInRegions]).toEqual(['EU', 'UK']);
    expect(MARKETING_SETTINGS_DEFAULTS.trMerchantExemptionEnabled).toBe(false);
  });

  it('matches region codes and exact countries', () => {
    for (const country of EU_EEA_COUNTRIES) {
      expect(complianceRegionOf(country)).toBe('EU');
      expect(requiresDoubleOptIn(['EU', 'UK'], country)).toBe(true);
    }
    expect(requiresDoubleOptIn(['EU', 'UK'], 'GB')).toBe(true);
    expect(requiresDoubleOptIn(['EU', 'UK'], 'gb')).toBe(true);
    expect(requiresDoubleOptIn(['EU', 'UK'], 'TR')).toBe(false);
    expect(requiresDoubleOptIn(['EU', 'UK'], 'US')).toBe(false);
    expect(requiresDoubleOptIn(['EU', 'UK'], null)).toBe(false);
    expect(requiresDoubleOptIn(['DE'], 'DE')).toBe(true);
    expect(requiresDoubleOptIn(['DE'], 'FR')).toBe(false);
    expect(requiresDoubleOptIn(['DEFAULT'], null)).toBe(true);
    expect(requiresDoubleOptIn(['DEFAULT'], 'BR')).toBe(true);
    expect(requiresDoubleOptIn([], 'DE')).toBe(false);
  });

  it('the settings schema accepts region and country codes, upper-cases and de-duplicates them', () => {
    const parsed = UpdateMarketingSettingsSchema.parse({ doubleOptInRegions: ['eu', 'UK', 'de', 'EU'], trMerchantExemptionEnabled: true });
    expect(parsed.doubleOptInRegions).toEqual(['EU', 'UK', 'DE']);
    expect(UpdateMarketingSettingsSchema.safeParse({ doubleOptInRegions: ['EUROPE'] }).success).toBe(false);
    expect(UpdateMarketingSettingsSchema.safeParse({ doubleOptInRegions: ['1A'] }).success).toBe(false);
    expect(DoubleOptInRegionsSchema.safeParse(new Array(101).fill('DE')).success).toBe(false);
  });
});

describe('reason codes and translations', () => {
  it('every M3e reason is a messaging engine reason and a precheck finding, with tr and en texts', () => {
    const en = BUNDLED_MESSAGES.en!;
    for (const code of CONSENT_INELIGIBILITY_REASONS) {
      expect(MESSAGE_SEND_REASON_CODES).toContain(code);
      expect(PRECHECK_FINDING_CODES).toContain(code);
      for (const key of [`campaigns.reason.${code}`, `marketingApprovals.finding.${code}`]) {
        expect((BASE_MESSAGES as Record<string, string>)[key]).toBeTruthy();
        expect(en[key]).toBeTruthy();
      }
    }
  });

  it('every resend error code is translated by the BFF', () => {
    for (const code of CONSENT_CONFIRMATION_ERROR_CODES) {
      expect(TRANSLATED_API_ERROR_CODES[code]).toBe(CONSENT_CONFIRMATION_TRANSLATED_ERRORS[code]);
    }
  });

  it('the token pattern is base64url of 32 bytes', () => {
    expect(CONSENT_CONFIRMATION_TOKEN_PATTERN.test('A'.repeat(43))).toBe(true);
    expect(CONSENT_CONFIRMATION_TOKEN_PATTERN.test('A'.repeat(42))).toBe(false);
    expect(CONSENT_CONFIRMATION_TOKEN_PATTERN.test(`${'A'.repeat(42)}=`)).toBe(false);
  });
});
