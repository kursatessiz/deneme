import type { SessionUserDTO } from '@platform/shared';

/** Where to land after signing in: the super admin console, the marketing panel, or the tenant dashboard. */
export function homePathFor(user: Pick<SessionUserDTO, 'isSuperAdmin' | 'platformAccess'>): string {
  if (user.isSuperAdmin) return '/admin';
  if (user.platformAccess) return '/pazarlama';
  return '/dashboard';
}

/**
 * Next page after a login (M1, docs/PAZARLAMA_MODULU.md 6.3): platform
 * accounts pass the TOTP step first when enrolled, and are sent to
 * enrolment when the policy requires it (for super admins that is the
 * "require enrolment at next login" grace, never a lockout).
 */
export function postLoginPath(user: Pick<SessionUserDTO, 'isSuperAdmin' | 'platformAccess' | 'mfa'>): string {
  const home = homePathFor(user);
  const needsStep = Boolean(user.mfa?.enabled && !user.mfa.verified);
  if (needsStep || user.mfa?.enrollmentRequired) return `/guvenlik/iki-adim?sonra=${encodeURIComponent(home)}`;
  return home;
}

/** Only same-app absolute paths are followed from `?sonra=`; anything else falls back. */
export function safeReturnPath(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}
