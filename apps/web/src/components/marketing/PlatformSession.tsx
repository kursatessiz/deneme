'use client';

import { createContext, useContext } from 'react';
import type { PlatformPermissionKey } from '@platform/shared';
import { Forbidden } from '@/components/common/Forbidden';
import { hasAnyPlatformPermission } from '@/lib/marketing-nav';

export interface PlatformSessionValue {
  platformStudioId: string;
  permissions: readonly PlatformPermissionKey[];
  isSuperAdmin: boolean;
}

const PlatformSessionContext = createContext<PlatformSessionValue | null>(null);

/** Platform permissions of the marketing panel's viewer (from GET /platform/context). */
export function PlatformSessionProvider({ value, children }: { value: PlatformSessionValue; children: React.ReactNode }) {
  return <PlatformSessionContext.Provider value={value}>{children}</PlatformSessionContext.Provider>;
}

export function usePlatformSession(): PlatformSessionValue {
  const ctx = useContext(PlatformSessionContext);
  if (!ctx) throw new Error('usePlatformSession must be used within PlatformSessionProvider');
  return ctx;
}

/** Platform-permission counterpart of PageGuard, for the panel's own screens. The API guards are the real boundary. */
export function PlatformPageGuard({ required, children }: { required: readonly PlatformPermissionKey[]; children: React.ReactNode }) {
  const { permissions, isSuperAdmin } = usePlatformSession();
  if (!hasAnyPlatformPermission(required, permissions, isSuperAdmin)) return <Forbidden />;
  return <>{children}</>;
}
