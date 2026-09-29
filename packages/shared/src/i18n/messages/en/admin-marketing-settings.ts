import type { trAdminMarketingSettings } from '../tr/admin-marketing-settings';

export const enAdminMarketingSettings = {
  'adminMarketingSettings.nav': 'Marketing Settings',
  'adminMarketingSettings.title': 'Marketing settings',
  'adminMarketingSettings.subtitle': 'Approval thresholds, daily caps and the weekly summary for the platform\'s own marketing. Every change is written to the audit log.',
  'adminMarketingSettings.loadFailed': 'The marketing settings could not be loaded.',
  'adminMarketingSettings.save': 'Save',
  'adminMarketingSettings.saved': 'Settings saved.',
  'adminMarketingSettings.invalid': 'Invalid value. Check that the numbers are zero or more.',
  'adminMarketingSettings.defaults': 'The defaults are in use; nothing has been saved yet.',
  'adminMarketingSettings.updatedAt': 'Last change: {date}',
  'adminMarketingSettings.noLimit': 'Leave empty for no limit.',

  'adminMarketingSettings.approval.title': 'Approval thresholds',
  'adminMarketingSettings.approval.description': 'A user with the send permission can start sends below these limits with their own approval. A first-time segment, a new country, a precheck warning and SMS to a United States recipient always need a super admin.',
  'adminMarketingSettings.field.selfApproveEmailMax': 'Email: maximum people',
  'adminMarketingSettings.field.selfApproveSmsMax': 'SMS and WhatsApp: maximum people',
  'adminMarketingSettings.field.selfApproveSmsCredits': 'SMS: maximum estimated credits',
  'adminMarketingSettings.field.approvalTtlHours': 'Approval request validity (hours)',
  'adminMarketingSettings.field.requireApprovalForSocial': 'Every organic social post needs approval',

  'adminMarketingSettings.caps.title': 'Daily caps',
  'adminMarketingSettings.caps.description': 'Stored now; enforcement comes in a later phase (M3d).',
  'adminMarketingSettings.field.dailyEmailCap': 'Daily commercial email cap',
  'adminMarketingSettings.field.dailySmsCreditCap': 'Daily SMS credit cap',
  'adminMarketingSettings.field.aiDailyCapCents': 'Daily AI cap (US dollar cents)',

  'adminMarketingSettings.adSpend.title': 'Monthly ad spend cap',
  'adminMarketingSettings.adSpend.description': 'Kept per currency; different currencies are never added together.',
  'adminMarketingSettings.adSpend.currency': 'Currency (ISO 4217)',
  'adminMarketingSettings.adSpend.amount': 'Monthly amount',
  'adminMarketingSettings.adSpend.add': 'Add currency',
  'adminMarketingSettings.adSpend.remove': 'Remove',
  'adminMarketingSettings.adSpend.empty': 'No cap defined.',
  'adminMarketingSettings.adSpend.invalid': 'The currency must be three capital letters and the amount a positive number with at most two decimals.',

  'adminMarketingSettings.autoPause.title': 'Auto-pause thresholds',
  'adminMarketingSettings.autoPause.description': 'Email campaigns are paused when these rates are exceeded over the last 24 hours. The values are stored; the automatic job comes in a later phase (M3d).',
  'adminMarketingSettings.field.bounceAutoPausePct': 'Bounce rate (%)',
  'adminMarketingSettings.field.complaintAutoPausePct': 'Complaint rate (%)',

  'adminMarketingSettings.weekly.title': 'Weekly summary',
  'adminMarketingSettings.weekly.description': 'Performance summary sent on Mondays (M3d). Recipients can only be platform users.',
  'adminMarketingSettings.field.weeklySummaryEnabled': 'Send the weekly summary',
  'adminMarketingSettings.weekly.recipients': 'Recipients',
  'adminMarketingSettings.weekly.noRecipients': 'No platform users.',
  'adminMarketingSettings.weekly.superAdmin': 'super admin',
} as const satisfies Record<keyof typeof trAdminMarketingSettings, string>;
