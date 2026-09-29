import type { CommercialIneligibilityReason, ComplianceRegion, ConsentFacts, ConsentLegalBasis, ConsentPolicy } from '@platform/shared';

export type CompliancePurpose = 'TRANSACTIONAL' | 'COMMERCIAL';
export type ComplianceChannel = 'WHATSAPP' | 'SMS' | 'EMAIL' | 'PUSH' | 'IN_APP';

export interface ComplianceRecipient {
  /** ISO 3166-1 alpha-2; drives which region's rule set applies (see regions.ts complianceRegionOf). */
  countryCode: string | null | undefined;
  /** IANA timezone for quiet-hours; falls back to the studio's timezone when the recipient has none of their own. */
  timezone: string | null | undefined;
  /**
   * Whether a GRANTED, explicit opt-in consent is on record for this
   * channel (KVKK/İYS for TR, GDPR opt-in for EU/UK, TCPA for US, ...).
   * Callers resolve this themselves (ConsentService.isGranted for TR today)
   * -- canSend does not reach into a consent store itself, so it stays a
   * pure, table-testable function.
   */
  consentGranted: boolean;
  /** US TCPA / general unsubscribe: an explicit STOP or unsubscribe click recorded for this recipient+channel. */
  optedOut?: boolean;
  /**
   * M3e legal basis facts (ContactConsentService.commercialFacts). When
   * present, canSend decides consent with the shared rule set
   * (evaluateCommercialEligibility: double opt-in, existing customer soft
   * opt-in, TR merchant exemption) instead of `consentGranted` alone.
   */
  legalBasis?: {
    policy: ConsentPolicy | null;
    consent: ConsentFacts;
    isBusiness: boolean;
    isExistingCustomer: boolean;
  };
}

export interface CanSendInput {
  recipient: ComplianceRecipient;
  channel: ComplianceChannel;
  purpose: CompliancePurpose;
  /** Defaults to `new Date()`; pass explicitly in tests for determinism. */
  now?: Date;
  /** Used for the recipient's quiet hours when the recipient has no timezone of their own. */
  studioTimezone?: string | null;
  /**
   * Skips the quiet-hours check (consent and opt-out are still enforced).
   * MessagingService (G1c) no longer sets it: quiet hours are enforced for
   * every COMMERCIAL message, and transactional ones return before any
   * check. Kept for callers that must deliberately bypass the window.
   */
  skipQuietHours?: boolean;
}

export interface CanSendResult {
  allow: boolean;
  /** Machine-readable reason for a deny, e.g. 'CONSENT_REQUIRED', 'QUIET_HOURS', 'OPTED_OUT', or an M3e legal-basis reason. Undefined when allowed. */
  reasonCode?: CommercialIneligibilityReason | 'QUIET_HOURS';
  /** The legal basis a commercial message goes out on (set when allowed with legal basis facts). */
  legalBasis?: ConsentLegalBasis;
  /** False when the basis was derived without a recorded consent row (the caller records it first). */
  legalBasisRecorded?: boolean;
  /** Human-readable (Turkish) reason, for logs and the sender's own diagnostics -- never shown to the recipient. */
  reason?: string;
  region: ComplianceRegion;
}
