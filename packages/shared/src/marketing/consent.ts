import { z } from 'zod';
import { COMPLIANCE_REGIONS, complianceRegionOf, type ComplianceRegion } from '../growth/regions';
import { vmsg } from '../validation-key';

/**
 * Legal basis of commercial messages and double opt-in (M3e,
 * docs/PAZARLAMA_MODULU.md 6.4 and 7.4). The API gathers the facts about a
 * recipient (consent row, member consent, business flag, customer status,
 * suppression) and the tenant's policy; `evaluateCommercialEligibility`
 * decides. It is pure so the whole matrix (region x legal basis x
 * confirmation x opt-out) is table tested here, and the compliance engine,
 * the messaging engine and the campaign precheck all share it.
 *
 * Nothing here names a country in the decision itself: what each
 * compliance region allows is the data in REGION_CONSENT_RULES, and which
 * regions need double opt-in is tenant data (MarketingSettings).
 */

export const CONSENT_LEGAL_BASES = ['CONSENT', 'TR_MERCHANT_EXEMPTION', 'EXISTING_CUSTOMER'] as const;
export type ConsentLegalBasis = (typeof CONSENT_LEGAL_BASES)[number];

/** M3e reason codes for a contact dropped from a commercial audience. */
export const CONSENT_INELIGIBILITY_REASONS = ['DOUBLE_OPT_IN_PENDING', 'NO_LEGAL_BASIS', 'TR_EXEMPTION_DISABLED'] as const;
export type ConsentIneligibilityReason = (typeof CONSENT_INELIGIBILITY_REASONS)[number];

/** Every reason a commercial message can be refused on consent grounds (the older codes plus the M3e ones). */
export type CommercialIneligibilityReason = 'OPTED_OUT' | 'CONSENT_REQUIRED' | ConsentIneligibilityReason;

/** Channels a consent legal basis is evaluated for. */
export type ConsentBasisChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';

/** Per compliance region: which bases other than explicit consent the region accepts. Data, reviewed with counsel. */
export interface RegionConsentRule {
  /**
   * Soft opt-in: the channels on which an existing customer may receive
   * messages about similar products without a separate consent, with an
   * unsubscribe in every message. EU/UK ePrivacy and PECR cover electronic
   * mail (e-mail and SMS); US CAN-SPAM covers e-mail only (TCPA still needs
   * prior express written consent for marketing SMS).
   */
  existingCustomerSoftOptIn: readonly ConsentBasisChannel[];
  /**
   * Businesses (merchants and tradespeople) may receive commercial messages
   * without prior consent, registered with the national consent registry,
   * when the tenant enables it (TR: İYS merchant exemption).
   */
  merchantExemption: boolean;
}

export const REGION_CONSENT_RULES: Readonly<Record<ComplianceRegion, RegionConsentRule>> = {
  TR: { existingCustomerSoftOptIn: [], merchantExemption: true },
  EU: { existingCustomerSoftOptIn: ['EMAIL', 'SMS', 'WHATSAPP'], merchantExemption: false },
  UK: { existingCustomerSoftOptIn: ['EMAIL', 'SMS', 'WHATSAPP'], merchantExemption: false },
  US: { existingCustomerSoftOptIn: ['EMAIL'], merchantExemption: false },
  // CASL implied consent has its own time limits; not modelled, so explicit consent only.
  CA: { existingCustomerSoftOptIn: [], merchantExemption: false },
  DEFAULT: { existingCustomerSoftOptIn: [], merchantExemption: false },
};

/** Default double opt-in list: data, editable in the super admin settings. */
export const DEFAULT_DOUBLE_OPT_IN_REGIONS: readonly string[] = ['EU', 'UK'];

/** A double opt-in list entry: a compliance region code (EU, UK, ...) or an ISO 3166-1 alpha-2 country. */
export const DoubleOptInRegionCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => (COMPLIANCE_REGIONS as readonly string[]).includes(v) || /^[A-Z]{2}$/.test(v), { message: vmsg('validation.invalidRegionOrCountryCode') });

export const DoubleOptInRegionsSchema = z
  .array(DoubleOptInRegionCodeSchema)
  .max(100)
  .transform((list) => [...new Set(list)]);

/**
 * Whether a person in `countryCode` needs double opt-in under `regions`.
 * An entry matches the person's compliance region (EU, UK, US, CA, TR,
 * DEFAULT for an unknown or unlisted country) or their exact country.
 */
export function requiresDoubleOptIn(regions: readonly string[], countryCode: string | null | undefined): boolean {
  if (regions.length === 0) return false;
  const country = countryCode ? countryCode.toUpperCase() : null;
  const region = complianceRegionOf(country);
  return regions.some((entry) => {
    const code = entry.toUpperCase();
    return code === region || (country !== null && code === country);
  });
}

/** Double opt-in link lifetime and resend limit. */
export const CONSENT_CONFIRMATION_TTL_DAYS = 7;
export const CONSENT_CONFIRMATION_DAILY_MAX = 3;
/** base64url of 32 random bytes. */
export const CONSENT_CONFIRMATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A tenant's consent policy; null for tenants without marketing settings (behaviour before M3e). */
export interface ConsentPolicy {
  doubleOptInRegions: readonly string[];
  trMerchantExemptionEnabled: boolean;
}

/** The recorded decision for one channel after merging the contact row and the member's own consent. */
export interface ConsentFacts {
  decision: 'GRANTED' | 'REVOKED' | 'NONE';
  decidedBy: 'contact' | 'member' | 'default';
  /** Of the contact row; null (rows before M3e) reads as CONSENT. */
  legalBasis: ConsentLegalBasis | null;
  /** Double opt-in was required at capture and the confirmation e-mail requested. */
  confirmationRequested: boolean;
  confirmed: boolean;
}

export interface EligibilityInput {
  region: ComplianceRegion;
  channel: ConsentBasisChannel;
  policy: ConsentPolicy | null;
  consent: ConsentFacts;
  /** Suppression list (unsubscribe, STOP, bounce, complaint). */
  optedOut: boolean;
  isBusiness: boolean;
  isExistingCustomer: boolean;
}

export type EligibilityResult =
  | { eligible: true; basis: ConsentLegalBasis; recorded: boolean }
  | { eligible: false; reason: CommercialIneligibilityReason };

/**
 * The M3e rule set for one recipient and channel, in this order:
 * 1. an opt-out (suppression) always wins, then an explicit revocation;
 * 2. without a policy (tenants that have no marketing settings) a granted
 *    consent is enough, exactly as before M3e;
 * 3. a granted row is judged by its legal basis: CONSENT needs the double
 *    opt-in confirmation when one was requested; EXISTING_CUSTOMER needs a
 *    region with soft opt-in on this channel and a current customer; TR_MERCHANT_EXEMPTION
 *    needs a region with the exemption, a business contact and the setting;
 * 4. with no row at all, a business in an exemption region is eligible
 *    only while the setting is on, and an existing customer only where
 *    soft opt-in exists.
 * `recorded` is false when the basis was derived without a consent row
 * (the caller records the exemption with the registry before sending).
 */
export function evaluateCommercialEligibility(input: EligibilityInput): EligibilityResult {
  const { consent, policy } = input;
  if (input.optedOut) return { eligible: false, reason: 'OPTED_OUT' };
  if (consent.decision === 'REVOKED') return { eligible: false, reason: 'CONSENT_REQUIRED' };

  if (!policy) {
    return consent.decision === 'GRANTED' ? { eligible: true, basis: 'CONSENT', recorded: true } : { eligible: false, reason: 'CONSENT_REQUIRED' };
  }

  const rule = REGION_CONSENT_RULES[input.region];
  const exemption = (recorded: boolean): EligibilityResult => {
    if (!rule.merchantExemption || !input.isBusiness) return { eligible: false, reason: 'NO_LEGAL_BASIS' };
    if (!policy.trMerchantExemptionEnabled) return { eligible: false, reason: 'TR_EXEMPTION_DISABLED' };
    return { eligible: true, basis: 'TR_MERCHANT_EXEMPTION', recorded };
  };
  const softOptIn = (recorded: boolean): EligibilityResult =>
    rule.existingCustomerSoftOptIn.includes(input.channel) && input.isExistingCustomer
      ? { eligible: true, basis: 'EXISTING_CUSTOMER', recorded }
      : { eligible: false, reason: 'NO_LEGAL_BASIS' };

  if (consent.decision === 'GRANTED') {
    // The member app's own opt-in is an explicit, authenticated consent.
    if (consent.decidedBy === 'member') return { eligible: true, basis: 'CONSENT', recorded: true };
    const basis = consent.legalBasis ?? 'CONSENT';
    if (basis === 'CONSENT') {
      if (consent.confirmationRequested && !consent.confirmed) return { eligible: false, reason: 'DOUBLE_OPT_IN_PENDING' };
      return { eligible: true, basis: 'CONSENT', recorded: true };
    }
    if (basis === 'EXISTING_CUSTOMER') return softOptIn(true);
    return exemption(true);
  }

  if (rule.merchantExemption && input.isBusiness) return exemption(false);
  if (input.isExistingCustomer) return softOptIn(false);
  return { eligible: false, reason: 'CONSENT_REQUIRED' };
}

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

/** POST /public/consent/confirm/:token: neutral, never says whose token it was. */
export interface ConsentConfirmResultDTO {
  result: 'CONFIRMED' | 'INVALID';
}

/** POST /platform/marketing/contacts/:id/resend-confirmation */
export interface ConsentResendResultDTO {
  sent: boolean;
  /** Confirmation e-mails sent to the contact in the last 24 hours, this one included. */
  sentToday: number;
}

/** Stable error codes of the resend endpoint (the web BFF translates them). */
export const CONSENT_CONFIRMATION_ERROR_CODES = ['CONSENT_CONFIRMATION_NOT_PENDING', 'CONSENT_CONFIRMATION_NO_EMAIL', 'CONSENT_CONFIRMATION_RATE_LIMITED'] as const;
export type ConsentConfirmationErrorCode = (typeof CONSENT_CONFIRMATION_ERROR_CODES)[number];

/** Translation keys the web BFF substitutes for the API message (TRANSLATED_API_ERROR_CODES). */
export const CONSENT_CONFIRMATION_TRANSLATED_ERRORS = {
  CONSENT_CONFIRMATION_NOT_PENDING: 'crm.card.consent.error.CONSENT_CONFIRMATION_NOT_PENDING',
  CONSENT_CONFIRMATION_NO_EMAIL: 'crm.card.consent.error.CONSENT_CONFIRMATION_NO_EMAIL',
  CONSENT_CONFIRMATION_RATE_LIMITED: 'crm.card.consent.error.CONSENT_CONFIRMATION_RATE_LIMITED',
} as const satisfies Record<ConsentConfirmationErrorCode, string>;

/** Built-in transactional template of the confirmation e-mail. */
export const CONSENT_CONFIRMATION_TEMPLATE_KEY = 'CONSENT_CONFIRMATION';
