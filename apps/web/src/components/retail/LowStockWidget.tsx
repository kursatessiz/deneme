'use client';

import Link from 'next/link';
import type { LowStockItemDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { hasAnyPermission } from '@/lib/nav';
import { sectionStyle } from './styles';

function LowStockList() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<{ items: LowStockItemDTO[] }>(`studios/${activeStudioId}/retail/stock/low`, activeStudioId);
  if (loading || error || !data) return null;
  const items = data.items.slice(0, 8);

  return (
    <section className="p-5 space-y-2" style={sectionStyle} aria-label={t('retail.lowStock.title')} data-testid="low-stock-widget">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('retail.lowStock.title')}
        </h3>
        <Link href="/magaza" className="text-xs font-medium hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
          {t('retail.lowStock.manage')}
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('retail.lowStock.empty')}
        </p>
      ) : (
        <ul className="text-sm space-y-1" style={{ color: 'var(--color-text-primary)' }}>
          {items.map((i) => (
            <li key={`${i.productId}-${i.branchId}`}>
              {t('retail.lowStock.row', { product: i.productName, branch: i.branchName, quantity: i.quantity, threshold: i.lowStockThreshold })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Dashboard widget: tracked products at or below their threshold. Rendered only for memberships with retail.view. */
export function LowStockWidget() {
  const { permissions, isOwner } = useDashboardSession();
  if (!hasAnyPermission(['retail.view'], permissions, isOwner)) return null;
  return <LowStockList />;
}
