import type { trAuth } from '../tr/auth';

export const enAuth = {
  'auth.login.title': 'Sign in to the management panel',
  'auth.login.subtitle': 'Sign in to manage your business',
  'auth.login.emailOrPhone': 'Email or phone',
  'auth.login.password': 'Password',
  'auth.login.submit': 'Sign in',
  'auth.login.submitting': 'Signing in...',
  'auth.login.useOtp': 'Request a one-time code by phone instead',
  'auth.login.usePassword': 'Sign in with a password instead',
  'auth.login.phone': 'Phone number',
  'auth.login.sendCode': 'Send code',
  'auth.login.sendingCode': 'Sending...',
  'auth.login.code': 'Verification code',
  'auth.login.verify': 'Verify and sign in',
  'auth.login.verifying': 'Verifying...',
  'auth.login.error.password': 'Could not sign in',
  'auth.login.error.otpRequest': 'Could not send the code',
  'auth.login.error.otpVerify': 'Could not verify the code',
} as const satisfies Record<keyof typeof trAuth, string>;
