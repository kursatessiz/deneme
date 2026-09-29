import type { trConsentConfirm } from '../tr/consent-confirm';

export const enConsentConfirm = {
  'consentConfirm.title': 'Confirm your subscription',
  'consentConfirm.description': 'You told us on a form that you would like to receive our news and offers. Press the button below to confirm.',
  'consentConfirm.confirm': 'Confirm subscription',
  'consentConfirm.done': 'Thank you, your subscription is confirmed. You can unsubscribe at any time with the link in every message.',
  'consentConfirm.invalid': 'This link is invalid, has expired or was already used. You can fill in the form again if needed.',
  'consentConfirm.error': 'Could not confirm right now, please try again in a moment.',
  'consentConfirm.note': 'Only the time and the form version are kept when you confirm; your IP address is not recorded.',
} as const satisfies Record<keyof typeof trConsentConfirm, string>;
