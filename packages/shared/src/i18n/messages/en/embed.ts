import type { trEmbed } from '../tr/embed';

/** English text for the `embed.*` namespace. Keep keys in sync with tr/embed.ts. */
export const enEmbed = {
  'embed.defaultTitle': 'Online booking',
  'embed.loading': 'Loading...',
  'embed.errors.loadFailed': 'Could not load the information',
  'embed.errors.loadFailedRetry': 'Could not load the information, please try again later.',
  'embed.chooseSession': 'Choose a session',
  'embed.choosePlaceholder': 'Choose a session',
  'embed.selectionHint': 'This only picks a time/service; no booking is made on this page.',
  'embed.openApp': "I'm a member, I'll book in the app",
  'embed.firstTime': "I'm new here, please contact me",
  'embed.fullName': 'Full name',
  'embed.phone': 'Your phone number',
  'embed.consent': 'I agree to be contacted by the business using this information.',
  'embed.back': 'Back',
  'embed.send': 'Send',
  'embed.sending': 'Sending...',
  'embed.errors.submitFailed': 'Could not be sent, please try again.',
  'embed.submitted.title': 'Your request has been received.',
  'embed.submitted.description': 'Our team will contact you shortly.',
  'embed.leadInterest.withSchedule': 'Trial session request via the web widget: {service} - {time}',
  'embed.leadInterest.withBranch': ' ({branch})',
  'embed.leadInterest.noSchedule': 'Trial session request via the web widget',
} as const satisfies Record<keyof typeof trEmbed, string>;
