import type { trJoinInvite } from '../tr/join-invite';

export const enJoinInvite = {
  'joinInvite.title': 'Invitation',
  'joinInvite.invitedTo': '{name} invited you',
  'joinInvite.role': 'Role: {role}',
  'joinInvite.greeting': 'Hello {fullName}',
  'joinInvite.invalid': 'The invitation was not found, has expired or was already used.',
  'joinInvite.sendCode': 'Send verification code',
  'joinInvite.codeSentTo': 'The code was sent to {phone}.',
  'joinInvite.code': 'Verification code',
  'joinInvite.pin': 'New PIN (6 digits)',
  'joinInvite.pinHint': 'Used to sign in to the mobile app. Leave it empty if you already set a PIN.',
  'joinInvite.documents': 'Texts to accept',
  'joinInvite.accept': 'I have read and accept',
  'joinInvite.submit': 'Accept invitation',
  'joinInvite.submitting': 'Sending...',
  'joinInvite.failed': 'The invitation could not be accepted.',
} as const satisfies Record<keyof typeof trJoinInvite, string>;
