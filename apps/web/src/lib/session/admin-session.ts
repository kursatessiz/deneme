import { cookies } from 'next/headers';
import type { PlatformContextDTO, SessionUserDTO } from '@platform/shared';
import { apiInternalBaseUrl } from '@/lib/server-env';
import { ACCESS_TOKEN_COOKIE } from '@/lib/bff/cookies';

/**
 * Server-side session check for the /admin route group. Deliberately
 * separate from getServerSession() (dashboard layout): a super admin has no
 * tenant membership to pick an active studio from, so this only needs
 * `isSuperAdmin`, not a studio context. The API's SuperAdminGuard is still
 * the real authorization boundary - this is the "server-side check in the
 * layout" CLAUDE.md's task asks for in addition to it.
 */
export async function getAdminSession(): Promise<SessionUserDTO | null> {
  const user = await getSessionUser();
  return user?.isSuperAdmin ? user : null;
}

/** `/auth/me` for the signed-in user whatever their role (admin and marketing shells, M1). Null without a valid session. */
export async function getSessionUser(): Promise<SessionUserDTO | null> {
  return serverApiGet<SessionUserDTO>('auth/me');
}

/** Platform tenant context of the marketing panel (`GET /platform/context`); null when the caller has no platform access. */
export async function getPlatformContext(): Promise<PlatformContextDTO | null> {
  return serverApiGet<PlatformContextDTO>('platform/context');
}

async function serverApiGet<T>(path: string): Promise<T | null> {
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) return null;
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Where a platform-level account must go before a platform shell renders
 * (docs/PAZARLAMA_MODULU.md 6.3): the TOTP step when enrolled but not yet
 * verified in this session; enrolment when the policy requires it. Super
 * admins without 2FA are not blocked here (grace): /giris sends them to
 * enrolment and the admin shell shows a reminder.
 */
export function twoFactorRedirect(user: SessionUserDTO, returnTo: string): string | null {
  const target = `/guvenlik/iki-adim?sonra=${encodeURIComponent(returnTo)}`;
  if (user.mfa?.enabled && !user.mfa.verified) return target;
  if (!user.isSuperAdmin && user.mfa?.enrollmentRequired) return target;
  return null;
}
