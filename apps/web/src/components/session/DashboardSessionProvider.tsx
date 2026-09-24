'use client';

import { createContext, useContext } from 'react';
import type { PermissionKey } from '@platform/shared';

export interface DashboardSessionValue {
  activeStudioId: string;
  permissions: readonly PermissionKey[];
  isOwner: boolean;
}

const DashboardSessionContext = createContext<DashboardSessionValue | null>(null);

export function DashboardSessionProvider({ value, children }: { value: DashboardSessionValue; children: React.ReactNode }) {
  return <DashboardSessionContext.Provider value={value}>{children}</DashboardSessionContext.Provider>;
}

/** Active studio + effective permission set of the signed-in membership, for client pages to gate fetches and UI. */
export function useDashboardSession(): DashboardSessionValue {
  const ctx = useContext(DashboardSessionContext);
  if (!ctx) throw new Error('useDashboardSession must be used within DashboardSessionProvider');
  return ctx;
}
