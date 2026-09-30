'use client';

import { localizedText } from '@platform/shared';
import type { StudioFeaturesDTO } from '@platform/shared';
import { EmptyState, LoadingState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';

/**
 * Module-off gate (G5c-2): renders `children` when the tenant's effective
 * feature `featureKey` is on. When it is off because an add-on is missing,
 * shows an empty state that links the owner to /ayarlar/uygulamalar (other
 * staff are told the owner has to activate the app). While the features are
 * loading, or when the request fails, it does not block: a network error must
 * never hide a module the tenant has (the API is the real gate).
 */
export function AddOnGate({ featureKey, children }: { featureKey: string; children: React.ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId, isOwner } = useDashboardSession();
  const { data, loading, error } = useBff<StudioFeaturesDTO>(`studios/${activeStudioId}/features`, activeStudioId);
  if (loading && !data) return <LoadingState />;
  if (error || !data || data.enabled.includes(featureKey)) return <>{children}</>;
  const unlock = data.unlockableBy.find((u) => u.featureFlagKey === featureKey);
  if (!unlock) return <>{children}</>;
  return (
    <EmptyState
      title={t('addOns.gate.title')}
      description={isOwner ? t('addOns.gate.description', { name: localizedText(unlock.name, locale) }) : t('addOns.gate.ownerOnly')}
      action={{ labelKey: 'addOns.gate.link', href: '/ayarlar/uygulamalar', permissions: ['billing.manage'] }}
    />
  );
}
