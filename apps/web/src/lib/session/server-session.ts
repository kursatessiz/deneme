import { cookies } from 'next/headers';
import type { MembershipDTO, SessionUserDTO } from '@platform/shared';
import { apiInternalBaseUrl } from '@/lib/server-env';
import { ACCESS_TOKEN_COOKIE, ACTIVE_BRANCH_COOKIE, ACTIVE_STUDIO_COOKIE } from '@/lib/bff/cookies';

export interface ServerSession {
  user: SessionUserDTO;
  activeStudioId: string;
  activeMembership: MembershipDTO;
  activeBranchId: string | null;
}

function pickDefaultStudioId(memberships: MembershipDTO[]): string | null {
  const active = memberships.find((m) => m.status === 'ACTIVE');
  return active?.studioId ?? memberships[0]?.studioId ?? null;
}

/**
 * Reads the session cookie and loads `/auth/me` server-side, for use in
 * server components (the dashboard layout, page-level permission guards).
 * Returns null when there is no session or the token is no longer valid --
 * callers redirect to /giris in that case. Never throws on a network or API
 * error; that would take down the whole dashboard shell.
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) return null;

  let user: SessionUserDTO;
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/auth/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    user = (await res.json()) as SessionUserDTO;
  } catch {
    return null;
  }

  const cookieStudioId = jar.get(ACTIVE_STUDIO_COOKIE)?.value;
  const activeStudioId =
    cookieStudioId && user.memberships.some((m) => m.studioId === cookieStudioId)
      ? cookieStudioId
      : pickDefaultStudioId(user.memberships);
  if (!activeStudioId) return null;

  const activeMembership = user.memberships.find((m) => m.studioId === activeStudioId);
  if (!activeMembership) return null;

  const activeBranchId = jar.get(ACTIVE_BRANCH_COOKIE)?.value ?? null;

  return { user, activeStudioId, activeMembership, activeBranchId };
}
