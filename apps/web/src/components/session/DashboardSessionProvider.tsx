'use client';

import { createContext, useContext, useMemo } from 'react';
import type { PermissionKey } from '@platform/shared';
import { formatMoney } from '@/lib/money';
import { useLocale } from '@/components/i18n/I18nProvider';

export interface DashboardSessionValue {
  activeStudioId: string;
  permissions: readonly PermissionKey[];
  isOwner: boolean;
  /** The active studio's currency (ISO 4217), from its region settings. Never hard-code 'TRY'. */
  currency: string;
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

/**
 * Binds `formatMoney` to the active studio's currency and the viewer's
 * resolved locale, so screens never hard-code either. `const fmt = useFormatMoney(); fmt('1234.50')`.
 */
export function useFormatMoney(): (amount: string | number | null | undefined) => string {
  const { currency } = useDashboardSession();
  const locale = useLocale();
  return useMemo(() => (amount: string | number | null | undefined) => formatMoney(amount, currency, locale), [currency, locale]);
}
