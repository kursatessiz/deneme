'use client';

import Link from 'next/link';
import type { LowStockItemDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { hasAnyPermission } from '@/lib/nav';
import { Card, CardContent } from '@/components/ui/Card';
import { List, ListItem } from '@/components/ui/List';

function LowStockList() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<{ items: LowStockItemDTO[] }>(`studios/${activeStudioId}/retail/stock/low`, activeStudioId);
  if (loading || error || !data) return null;
  const items = data.items.slice(0, 8);

  return (
    <Card as="section" aria-label={t('retail.lowStock.title')} data-testid="low-stock-widget">
      <CardContent>
        <div className="flex items-center justify-between gap-2">
          <h3 className="ui-heading">{t('retail.lowStock.title')}</h3>
          <Link href="/magaza" className="pui-link pui-surface">
            {t('retail.lowStock.manage')}
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="ui-caption">{t('retail.lowStock.empty')}</p>
        ) : (
          <List>
            {items.map((i) => (
              <ListItem key={`${i.productId}-${i.branchId}`}>
                {t('retail.lowStock.row', { product: i.productName, branch: i.branchName, quantity: i.quantity, threshold: i.lowStockThreshold })}
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}

/** Dashboard widget: tracked products at or below their threshold. Rendered only for memberships with retail.view. */
export function LowStockWidget() {
  const { permissions, isOwner } = useDashboardSession();
  if (!hasAnyPermission(['retail.view'], permissions, isOwner)) return null;
  return <LowStockList />;
}
