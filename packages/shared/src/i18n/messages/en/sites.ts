import type { trSites } from '../tr/sites';

export const enSites: Record<keyof typeof trSites, string> = {
  'sites.legalDraftBanner': 'Draft: this text still needs legal review.',
  'sites.leadForm.fullName': 'Full name',
  'sites.leadForm.phone': 'Phone',
  'sites.leadForm.email': 'Email',
  'sites.leadForm.message': 'Your message',
  'sites.leadForm.defaultConsent': 'I agree to be contacted by this business using the details above.',
  'sites.leadForm.submit': 'Send',
  'sites.leadForm.sent': 'Thanks, we will get back to you shortly.',
  'sites.leadForm.error': 'Could not send, please try again.',
  'sites.bookingWidget.defaultButton': 'Book now',
  'sites.footer.cookiePreferences': 'Cookie preferences',
} as const;
