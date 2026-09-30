import { useEffect, useState } from 'react';

import type { PlatformContextDTO, PlatformPermissionKey } from '@platform/shared';

import { apiRequest } from './api';

export interface PlatformAccess {
  /** False until GET /platform/context answered (or was skipped for an account without platform access). */
  ready: boolean;
  permissions: readonly PlatformPermissionKey[];
}

const NONE: PlatformAccess = { ready: true, permissions: [] };

/**
 * Platform-level permissions of the signed-in account, from GET /platform/context.
 * Only super admins are asked (the only accounts that decide marketing approvals
 * today); everyone else gets an empty set without a request. A failed call also
 * yields an empty set, so a platform screen never opens on a guess and the API
 * guards remain the real boundary.
 */
export function usePlatformAccess(isSuperAdmin: boolean): PlatformAccess {
  const [access, setAccess] = useState<PlatformAccess>(isSuperAdmin ? { ready: false, permissions: [] } : NONE);

  useEffect(() => {
    if (!isSuperAdmin) {
      setAccess(NONE);
      return;
    }
    let cancelled = false;
    apiRequest<PlatformContextDTO>('/platform/context')
      .then((context) => {
        if (!cancelled) setAccess({ ready: true, permissions: context.permissions });
      })
      .catch(() => {
        if (!cancelled) setAccess(NONE);
      });
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  return access;
}
