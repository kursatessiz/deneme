import { ComplianceService } from './compliance.service';

describe('ComplianceService.canSend', () => {
  const service = new ComplianceService();
  // 2026-06-15T12:00:00Z: noon UTC, safely inside every timezone's 08:00-21:00 window used below.
  const NOON_UTC = new Date('2026-06-15T12:00:00.000Z');

  it('always allows a transactional message, consent or not', () => {
    const result = service.canSend({
      recipient: { countryCode: 'TR', timezone: 'Europe/Istanbul', consentGranted: false },
      channel: 'SMS',
      purpose: 'TRANSACTIONAL',
      now: NOON_UTC,
    });
    expect(result.allow).toBe(true);
  });

  describe.each([
    ['TR', 'Europe/Istanbul'],
    ['EU', 'Europe/Berlin'],
    ['UK', 'Europe/London'],
    ['US', 'America/New_York'],
    ['CA', 'America/Toronto'],
    ['DEFAULT', 'Africa/Cairo'],
  ] as const)('region %s', (region, timezone) => {
    const countryCode = region === 'TR' ? 'TR' : region === 'EU' ? 'DE' : region === 'UK' ? 'GB' : region === 'US' ? 'US' : region === 'CA' ? 'CA' : 'EG';

    it('denies a commercial message without a granted consent', () => {
      const result = service.canSend({
        recipient: { countryCode, timezone, consentGranted: false },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: NOON_UTC,
      });
      expect(result.allow).toBe(false);
      expect(result.reasonCode).toBe('CONSENT_REQUIRED');
      expect(result.region).toBe(region);
    });

    it('allows a commercial message with granted consent inside quiet hours', () => {
      const result = service.canSend({
        recipient: { countryCode, timezone, consentGranted: true },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: NOON_UTC,
      });
      expect(result.allow).toBe(true);
    });
  });

  it('denies a commercial message from an opted-out recipient even with a prior granted consent', () => {
    const result = service.canSend({
      recipient: { countryCode: 'US', timezone: 'America/New_York', consentGranted: true, optedOut: true },
      channel: 'SMS',
      purpose: 'COMMERCIAL',
      now: NOON_UTC,
    });
    expect(result.allow).toBe(false);
    expect(result.reasonCode).toBe('OPTED_OUT');
  });

  describe('quiet hours', () => {
    it('denies a commercial send before 08:00 local time', () => {
      // 2026-06-15T05:00:00Z is 01:00 in America/New_York (EDT, UTC-4).
      const result = service.canSend({
        recipient: { countryCode: 'US', timezone: 'America/New_York', consentGranted: true },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: new Date('2026-06-15T05:00:00.000Z'),
      });
      expect(result.allow).toBe(false);
      expect(result.reasonCode).toBe('QUIET_HOURS');
    });

    it('denies a commercial send at/after 21:00 local time', () => {
      // 2026-06-15T01:30:00Z is 21:30 the previous day in America/New_York (EDT).
      const result = service.canSend({
        recipient: { countryCode: 'US', timezone: 'America/New_York', consentGranted: true },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: new Date('2026-06-15T01:30:00.000Z'),
      });
      expect(result.allow).toBe(false);
      expect(result.reasonCode).toBe('QUIET_HOURS');
    });

    it('allows a commercial send at exactly 08:00 local time', () => {
      // 2026-06-15T12:00:00Z is 08:00 in America/New_York (EDT, UTC-4).
      const result = service.canSend({
        recipient: { countryCode: 'US', timezone: 'America/New_York', consentGranted: true },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: new Date('2026-06-15T12:00:00.000Z'),
      });
      expect(result.allow).toBe(true);
    });

    it('handles the US winter/standard-time offset correctly (DST boundary)', () => {
      // 2026-01-15T12:00:00Z is 07:00 in America/New_York (EST, UTC-5 in January) -- still quiet hours.
      const winterResult = service.canSend({
        recipient: { countryCode: 'US', timezone: 'America/New_York', consentGranted: true },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: new Date('2026-01-15T12:00:00.000Z'),
      });
      expect(winterResult.allow).toBe(false);
      expect(winterResult.reasonCode).toBe('QUIET_HOURS');

      // The same wall-clock UTC instant one hour later (13:00Z) is 08:00 EST -- allowed.
      const winterAllowed = service.canSend({
        recipient: { countryCode: 'US', timezone: 'America/New_York', consentGranted: true },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: new Date('2026-01-15T13:00:00.000Z'),
      });
      expect(winterAllowed.allow).toBe(true);
    });

    it('falls back to the studio timezone when the recipient has none of their own', () => {
      const result = service.canSend({
        recipient: { countryCode: 'TR', timezone: null, consentGranted: true },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: new Date('2026-06-15T05:00:00.000Z'), // 08:00 Europe/Istanbul (UTC+3)
        studioTimezone: 'Europe/Istanbul',
      });
      expect(result.allow).toBe(true);
    });

    it('skipQuietHours bypasses the quiet-hours check but still enforces consent', () => {
      const outsideHours = new Date('2026-06-15T05:00:00.000Z');
      const withoutSkip = service.canSend({
        recipient: { countryCode: 'US', timezone: 'America/New_York', consentGranted: true },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: outsideHours,
      });
      expect(withoutSkip.allow).toBe(false);

      const withSkip = service.canSend({
        recipient: { countryCode: 'US', timezone: 'America/New_York', consentGranted: true },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: outsideHours,
        skipQuietHours: true,
      });
      expect(withSkip.allow).toBe(true);

      const withSkipNoConsent = service.canSend({
        recipient: { countryCode: 'US', timezone: 'America/New_York', consentGranted: false },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: outsideHours,
        skipQuietHours: true,
      });
      expect(withSkipNoConsent.allow).toBe(false);
      expect(withSkipNoConsent.reasonCode).toBe('CONSENT_REQUIRED');
    });
  });

  describe('TR path (İYS)', () => {
    it('denies without the İYS-backed consent flag and names KVKK/İYS in the reason', () => {
      const result = service.canSend({
        recipient: { countryCode: 'TR', timezone: 'Europe/Istanbul', consentGranted: false },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: NOON_UTC,
      });
      expect(result.allow).toBe(false);
      expect(result.reason).toMatch(/KVKK|İYS/);
    });

    it('allows once the caller resolves the İYS consent as granted (TrConsentRegistryAdapter.isGranted)', () => {
      const result = service.canSend({
        recipient: { countryCode: 'TR', timezone: 'Europe/Istanbul', consentGranted: true },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: NOON_UTC,
      });
      expect(result.allow).toBe(true);
    });
  });

  describe('M3e legal basis facts', () => {
    const policy = { doubleOptInRegions: ['EU', 'UK'], trMerchantExemptionEnabled: false };
    const facts = (over: Record<string, unknown> = {}) => ({
      policy,
      consent: { decision: 'GRANTED' as const, decidedBy: 'contact' as const, legalBasis: 'CONSENT' as const, confirmationRequested: true, confirmed: false },
      isBusiness: false,
      isExistingCustomer: false,
      ...over,
    });

    it('holds an EU form consent until the double opt-in is confirmed, whatever consentGranted says', () => {
      const pending = service.canSend({
        recipient: { countryCode: 'DE', timezone: 'Europe/Berlin', consentGranted: true, legalBasis: facts() },
        channel: 'EMAIL',
        purpose: 'COMMERCIAL',
        now: NOON_UTC,
      });
      expect(pending).toMatchObject({ allow: false, reasonCode: 'DOUBLE_OPT_IN_PENDING', region: 'EU' });
      const confirmed = service.canSend({
        recipient: {
          countryCode: 'DE',
          timezone: 'Europe/Berlin',
          consentGranted: true,
          legalBasis: facts({ consent: { decision: 'GRANTED', decidedBy: 'contact', legalBasis: 'CONSENT', confirmationRequested: true, confirmed: true } }),
        },
        channel: 'EMAIL',
        purpose: 'COMMERCIAL',
        now: NOON_UTC,
      });
      expect(confirmed).toMatchObject({ allow: true, legalBasis: 'CONSENT', legalBasisRecorded: true });
    });

    it('lets a US existing customer receive commercial e-mail under EXISTING_CUSTOMER, not a TR one', () => {
      const none = { decision: 'NONE' as const, decidedBy: 'default' as const, legalBasis: null, confirmationRequested: false, confirmed: false };
      const us = service.canSend({
        recipient: { countryCode: 'US', timezone: 'America/New_York', consentGranted: false, legalBasis: facts({ consent: none, isExistingCustomer: true }) },
        channel: 'EMAIL',
        purpose: 'COMMERCIAL',
        now: NOON_UTC,
      });
      expect(us).toMatchObject({ allow: true, legalBasis: 'EXISTING_CUSTOMER', legalBasisRecorded: false });
      const tr = service.canSend({
        recipient: { countryCode: 'TR', timezone: 'Europe/Istanbul', consentGranted: false, legalBasis: facts({ consent: none, isExistingCustomer: true }) },
        channel: 'EMAIL',
        purpose: 'COMMERCIAL',
        now: NOON_UTC,
      });
      expect(tr).toMatchObject({ allow: false, reasonCode: 'NO_LEGAL_BASIS' });
    });

    it('an opt-out beats every basis and the TR exemption follows the setting', () => {
      const none = { decision: 'NONE' as const, decidedBy: 'default' as const, legalBasis: null, confirmationRequested: false, confirmed: false };
      const optedOut = service.canSend({
        recipient: { countryCode: 'TR', timezone: 'Europe/Istanbul', consentGranted: true, optedOut: true, legalBasis: facts({ consent: none, isBusiness: true, policy: { ...policy, trMerchantExemptionEnabled: true } }) },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: NOON_UTC,
      });
      expect(optedOut.reasonCode).toBe('OPTED_OUT');
      const off = service.canSend({
        recipient: { countryCode: 'TR', timezone: 'Europe/Istanbul', consentGranted: false, legalBasis: facts({ consent: none, isBusiness: true }) },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: NOON_UTC,
      });
      expect(off.reasonCode).toBe('TR_EXEMPTION_DISABLED');
      const on = service.canSend({
        recipient: { countryCode: 'TR', timezone: 'Europe/Istanbul', consentGranted: false, legalBasis: facts({ consent: none, isBusiness: true, policy: { ...policy, trMerchantExemptionEnabled: true } }) },
        channel: 'SMS',
        purpose: 'COMMERCIAL',
        now: NOON_UTC,
      });
      expect(on).toMatchObject({ allow: true, legalBasis: 'TR_MERCHANT_EXEMPTION' });
    });
  });
});
