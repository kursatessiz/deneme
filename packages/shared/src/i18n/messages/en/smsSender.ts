import type { trSmsSender } from '../tr/smsSender';

export const enSmsSender = {
  'smsSender.title': 'SMS sender identity',
  'smsSender.description': 'The registration status of the alphanumeric sender ID at each provider, and the US 10DLC brand and campaign status for Twilio. Entered by hand for now; not read from the provider automatically.',
  'smsSender.provider': 'Provider',
  'smsSender.senderId': 'Sender ID',
  'smsSender.status': 'Registration status',
  'smsSender.active': 'In use',
  'smsSender.save': 'Save',
  'smsSender.status.NOT_STARTED': 'Not started',
  'smsSender.status.PENDING': 'Pending approval',
  'smsSender.status.APPROVED': 'Approved',
  'smsSender.status.REJECTED': 'Rejected',
  'smsSender.tenDlc.title': 'Twilio 10DLC (US)',
  'smsSender.tenDlc.brand': 'Brand status',
  'smsSender.tenDlc.campaign': 'Campaign status',
  'smsSender.tenDlc.notEntered': 'Not entered yet',
  'smsSender.updatedAt': 'Updated: {date}',
  'smsSender.senderIdHelp': '3 to 11 characters, starting with a letter; letters, digits and spaces only.',
} as const satisfies Record<keyof typeof trSmsSender, string>;
