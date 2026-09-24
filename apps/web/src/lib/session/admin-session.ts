import { cookies } from 'next/headers';
import type { SessionUserDTO } from '@platform/shared';
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
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) return null;

  try {
    const res = await fetch(`${apiInternalBaseUrl()}/auth/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const user = (await res.json()) as SessionUserDTO;
    return user.isSuperAdmin ? user : null;
  } catch {
    return null;
  }
}
