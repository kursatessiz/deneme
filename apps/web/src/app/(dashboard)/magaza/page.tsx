'use client';

import { useState } from 'react';
import type { PermissionKey } from '@platform/shared';
import { LinkButton, PageHeader } from '@/components/ui';
import { PageGuard } from '@/components/common/PageGuard';
import { Tabs } from '@/components/common/Tabs';
import { useT } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { hasAnyPermission } from '@/lib/nav';
import { ProductsTab } from '@/components/retail/ProductsTab';
import { MovementsTab } from '@/components/retail/MovementsTab';
import { SalesTab } from '@/components/retail/SalesTab';
import { ReportTab } from '@/components/retail/ReportTab';
import { SettingsTab } from '@/components/retail/SettingsTab';

const TABS: readonly { key: 'products' | 'movements' | 'sales' | 'report' | 'settings'; required: readonly PermissionKey[] }[] = [
  { key: 'products', required: ['retail.view'] },
  { key: 'sales', required: ['retail.view'] },
  { key: 'movements', required: ['retail.view'] },
  { key: 'report', required: ['retail.view'] },
  { key: 'settings', required: ['retail.manage'] },
];

/** Store (G3c-2, docs/PERAKENDE.md): catalogue and stock, sales history with refunds, report and settings. */
function StorePage() {
  const t = useT();
  const { permissions, isOwner } = useDashboardSession();
  const visible = TABS.filter((tab) => hasAnyPermission(tab.required, permissions, isOwner));
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>(visible[0]?.key ?? 'products');

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('retail.title')}
        description={t('retail.subtitle')}
        actions={
          hasAnyPermission(['retail.sell'], permissions, isOwner) ? (
            <LinkButton href="/magaza/satis" size="sm">
              {t('retail.quickSaleLink')}
            </LinkButton>
          ) : undefined
        }
      />

      <Tabs tabs={visible.map((v) => ({ key: v.key, label: t(`retail.tabs.${v.key}`) }))} active={tab} onChange={(k) => setTab(k as typeof tab)} />

      {tab === 'products' && <ProductsTab />}
      {tab === 'sales' && <SalesTab />}
      {tab === 'movements' && <MovementsTab />}
      {tab === 'report' && <ReportTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['retail.view']}>
      <StorePage />
    </PageGuard>
  );
}
