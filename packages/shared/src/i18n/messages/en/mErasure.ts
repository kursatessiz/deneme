import type { trMErasure } from '../tr/mErasure';

export const enMErasure: Record<keyof typeof trMErasure, string> = {
  'mErasure.title': 'Privacy',
  'mErasure.lead':
    'Under GDPR and KVKK you can ask for your personal data at this business to be erased. The business reviews your request; payment, invoice and booking records are kept for legal retention without identifying you. If the request is not handled it is processed automatically within 30 days.',
  'mErasure.request.action': 'Request erasure of my data',
  'mErasure.request.confirm': 'Your personal data at this business will be anonymized and you will lose access to your account there. This cannot be undone. Send the request?',
  'mErasure.request.confirmYes': 'Send request',
  'mErasure.request.cancel': 'Cancel',
  'mErasure.request.sent': 'Your request was received.',
  'mErasure.status.title': 'Request status',
  'mErasure.status.PENDING': 'Your request is being reviewed. Processing deadline: {date}.',
  'mErasure.status.APPROVED': 'Your request was approved and will be processed shortly.',
  'mErasure.status.REJECTED': 'Your request was rejected.',
  'mErasure.status.COMPLETED': 'Your personal data was anonymized.',
  'mErasure.status.reason': 'Reason: {reason}',
  'mErasure.errors.loadFailed': 'Could not load the request status.',
  'mErasure.errors.requestFailed': 'Could not send the request.',
};
