import {
  MARKETING_APPROVAL_ERROR_CODES,
  MARKETING_APPROVAL_TRANSLATED_ERRORS,
  RejectRequestSchema,
  approvalExpiresAt,
  approvalOutcomeFor,
  canPauseCampaign,
  canRequestCampaignApproval,
  canResumeCampaign,
  decideSelfApproval,
  isApprovalExpired,
  type SelfApprovalInput,
} from './approvals';
import { MARKETING_SETTINGS_DEFAULTS, UpdateMarketingSettingsSchema } from './settings';
import { TRANSLATED_API_ERROR_CODES } from '../billing';
import { BUNDLED_MESSAGES } from '../i18n/messages';

const clean: SelfApprovalInput = {
  channels: ['EMAIL'],
  audienceTotal: 500,
  smsCredits: 0,
  usSmsRecipients: false,
  segmentApprovedBefore: true,
  newCountries: [],
  findings: [{ code: 'CONSENT_MISSING', severity: 'info', channel: null, count: 3 }],
  emailDomainVerified: true,
  thresholds: { selfApproveEmailMax: 1000, selfApproveSmsMax: 100, selfApproveSmsCredits: 100 },
};
const sms: SelfApprovalInput = { ...clean, channels: ['SMS'], audienceTotal: 80, smsCredits: 70, emailDomainVerified: false };

describe('decideSelfApproval (section 6.1 matrix)', () => {
  it('self-approves an email send under the threshold with a clean precheck and a verified domain', () => {
    expect(decideSelfApproval(clean)).toEqual({ selfApprovable: true, reasons: [] });
  });

  it('allows exactly the threshold and refuses one more', () => {
    expect(decideSelfApproval({ ...clean, audienceTotal: 1000 }).selfApprovable).toBe(true);
    expect(decideSelfApproval({ ...clean, audienceTotal: 1001 })).toEqual({ selfApprovable: false, reasons: ['EMAIL_OVER_THRESHOLD'] });
  });

  it('needs a verified sender domain for email only', () => {
    expect(decideSelfApproval({ ...clean, emailDomainVerified: false }).reasons).toEqual(['EMAIL_DOMAIN_NOT_VERIFIED']);
    expect(decideSelfApproval(sms)).toEqual({ selfApprovable: true, reasons: [] });
  });

  it('checks the SMS audience and the credit estimate separately (WhatsApp uses the SMS limits)', () => {
    expect(decideSelfApproval({ ...sms, audienceTotal: 101 }).reasons).toEqual(['SMS_OVER_THRESHOLD']);
    expect(decideSelfApproval({ ...sms, smsCredits: 101 }).reasons).toEqual(['SMS_CREDITS_OVER_THRESHOLD']);
    expect(decideSelfApproval({ ...sms, channels: ['WHATSAPP'], audienceTotal: 150 }).reasons).toEqual(['SMS_OVER_THRESHOLD']);
  });

  it('always requires a super admin for a first-time segment', () => {
    expect(decideSelfApproval({ ...clean, segmentApprovedBefore: false }).reasons).toEqual(['FIRST_TIME_SEGMENT']);
  });

  it('always requires a super admin when a new country appears', () => {
    expect(decideSelfApproval({ ...clean, newCountries: ['DE'] }).reasons).toEqual(['NEW_REGION']);
  });

  it('always requires a super admin on any precheck warning, but not on info findings', () => {
    expect(decideSelfApproval({ ...clean, findings: [{ code: 'PHYSICAL_ADDRESS_MISSING', severity: 'warning', channel: 'EMAIL', count: null }] }).reasons).toEqual([
      'PRECHECK_WARNING',
    ]);
    expect(decideSelfApproval({ ...clean, findings: [{ code: 'QUIET_HOURS', severity: 'info', channel: null, count: 9 }] }).selfApprovable).toBe(true);
  });

  it('always requires a super admin for SMS reaching the United States, however small', () => {
    expect(decideSelfApproval({ ...sms, audienceTotal: 1, smsCredits: 1, usSmsRecipients: true }).reasons).toEqual(['US_SMS_RECIPIENT']);
    // WhatsApp is not SMS: the US rule is about text messages.
    expect(decideSelfApproval({ ...sms, channels: ['WHATSAPP'], usSmsRecipients: true }).selfApprovable).toBe(true);
  });

  it('never self-approves push or in-app sends, nor a send without a channel', () => {
    expect(decideSelfApproval({ ...clean, channels: ['PUSH'] }).reasons).toEqual(['CHANNEL_REQUIRES_APPROVAL']);
    expect(decideSelfApproval({ ...clean, channels: [] }).reasons).toEqual(['CHANNEL_REQUIRES_APPROVAL']);
  });

  it('lists every reason that applies, in catalogue order', () => {
    const all = decideSelfApproval({
      ...clean,
      channels: ['EMAIL', 'SMS'],
      audienceTotal: 5000,
      smsCredits: 5000,
      usSmsRecipients: true,
      segmentApprovedBefore: false,
      newCountries: ['US'],
      emailDomainVerified: false,
      findings: [{ code: 'US_SMS_RECIPIENTS', severity: 'warning', channel: 'SMS', count: 1 }],
    });
    expect(all.reasons).toEqual([
      'EMAIL_OVER_THRESHOLD',
      'SMS_OVER_THRESHOLD',
      'SMS_CREDITS_OVER_THRESHOLD',
      'FIRST_TIME_SEGMENT',
      'NEW_REGION',
      'PRECHECK_WARNING',
      'US_SMS_RECIPIENT',
      'EMAIL_DOMAIN_NOT_VERIFIED',
    ]);
  });
});

describe('four eyes', () => {
  it('a different approver approves', () => {
    expect(approvalOutcomeFor({ requestedByUserId: 'a', approverUserId: 'b', approverIsSuperAdmin: true })).toBe('APPROVED');
  });

  it('the requester cannot approve their own request', () => {
    expect(approvalOutcomeFor({ requestedByUserId: 'a', approverUserId: 'a', approverIsSuperAdmin: false })).toBe('FOUR_EYES_VIOLATION');
  });

  it('a super admin approving their own request is recorded as SELF_APPROVED', () => {
    expect(approvalOutcomeFor({ requestedByUserId: 'a', approverUserId: 'a', approverIsSuperAdmin: true })).toBe('SELF_APPROVED');
  });
});

describe('expiry', () => {
  const created = new Date('2026-10-01T10:00:00Z');
  const expiresAt = approvalExpiresAt(created, MARKETING_SETTINGS_DEFAULTS.approvalTtlHours);

  it('expires after the TTL', () => {
    expect(expiresAt.toISOString()).toBe('2026-10-04T10:00:00.000Z');
    expect(isApprovalExpired({ status: 'PENDING', expiresAt }, new Date('2026-10-04T09:59:59Z'))).toBe(false);
    expect(isApprovalExpired({ status: 'PENDING', expiresAt }, new Date('2026-10-04T10:00:00Z'))).toBe(true);
  });

  it('only a pending request expires', () => {
    expect(isApprovalExpired({ status: 'APPROVED', expiresAt }, new Date('2027-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('campaign state machine', () => {
  it('pauses only scheduled or sending campaigns and resumes only paused ones', () => {
    expect(['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'PENDING_APPROVAL', 'PAUSED'].filter(canPauseCampaign)).toEqual(['SCHEDULED', 'SENDING']);
    expect(['DRAFT', 'SCHEDULED', 'SENDING', 'PAUSED'].filter(canResumeCampaign)).toEqual(['PAUSED']);
    expect(['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'PENDING_APPROVAL', 'PAUSED'].filter(canRequestCampaignApproval)).toEqual([
      'DRAFT',
      'SCHEDULED',
      'PENDING_APPROVAL',
    ]);
  });
});

describe('schemas and translations', () => {
  it('a rejection needs a note', () => {
    expect(RejectRequestSchema.safeParse({}).success).toBe(false);
    expect(RejectRequestSchema.safeParse({ note: '  ' }).success).toBe(false);
    expect(RejectRequestSchema.safeParse({ note: 'Kitle fazla genis' }).success).toBe(true);
  });

  it('settings: every field is optional, caps are per currency with decimal strings', () => {
    expect(UpdateMarketingSettingsSchema.safeParse({}).success).toBe(true);
    expect(UpdateMarketingSettingsSchema.safeParse({ monthlyAdSpendCaps: { EUR: '1500.50', USD: '2000' } }).success).toBe(true);
    expect(UpdateMarketingSettingsSchema.safeParse({ monthlyAdSpendCaps: { eur: '10' } }).success).toBe(false);
    expect(UpdateMarketingSettingsSchema.safeParse({ monthlyAdSpendCaps: { EUR: 10 } }).success).toBe(false);
    expect(UpdateMarketingSettingsSchema.safeParse({ monthlyAdSpendCaps: { EUR: '1.234' } }).success).toBe(false);
    expect(UpdateMarketingSettingsSchema.safeParse({ selfApproveEmailMax: -1 }).success).toBe(false);
    expect(UpdateMarketingSettingsSchema.safeParse({ approvalTtlHours: 0 }).success).toBe(false);
    expect(UpdateMarketingSettingsSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });

  it('every error code is translated in tr and en and routed through the BFF table', () => {
    for (const code of MARKETING_APPROVAL_ERROR_CODES) {
      const key = MARKETING_APPROVAL_TRANSLATED_ERRORS[code];
      expect(TRANSLATED_API_ERROR_CODES[code]).toBe(key);
      expect(BUNDLED_MESSAGES.tr[key]).toBeTruthy();
      expect(BUNDLED_MESSAGES.en[key]).toBeTruthy();
    }
  });
});
