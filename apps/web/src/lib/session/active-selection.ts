'use client';

import { ACTIVE_BRANCH_COOKIE, ACTIVE_STUDIO_COOKIE } from '@/lib/bff/cookies';

/** Client-side cookie writer for the plain (non-httpOnly) active studio/branch cookies. */
function setPlainCookie(name: string, value: string) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function setActiveStudioCookie(studioId: string) {
  setPlainCookie(ACTIVE_STUDIO_COOKIE, studioId);
}

export function setActiveBranchCookie(branchId: string) {
  setPlainCookie(ACTIVE_BRANCH_COOKIE, branchId);
}
