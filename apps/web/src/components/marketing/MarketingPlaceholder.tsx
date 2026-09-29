'use client';

import type { MessageKey, PlatformPermissionKey } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { EmptyState } from '@/components/common/DataState';
import { PlatformPageGuard } from './PlatformSession';

/** A marketing panel section that a later phase fills (M2/M3); the route and its permission exist from M1. */
export function MarketingPlaceholder({
  titleKey,
  descriptionKey,
  required,
}: {
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  required: readonly PlatformPermissionKey[];
}) {
  const t = useT();
  return (
    <PlatformPageGuard required={required}>
      <div className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {t(titleKey)}
        </h2>
        <EmptyState title={t('marketing.placeholder.soon')} description={t(descriptionKey)} />
      </div>
    </PlatformPageGuard>
  );
}
