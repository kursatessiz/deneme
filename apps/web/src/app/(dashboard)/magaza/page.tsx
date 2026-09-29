'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PermissionKey } from '@platform/shared';
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            {t('retail.title')}
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {t('retail.subtitle')}
          </p>
        </div>
        {hasAnyPermission(['retail.sell'], permissions, isOwner) && (
          <Link
            href="/magaza/satis"
            className="text-xs font-medium px-3.5 py-2 transition-opacity hover:opacity-90"
            style={{ borderRadius: 'var(--radius-button)', background: 'var(--gradient-brand)', color: 'var(--color-on-primary)' }}
          >
            {t('retail.quickSaleLink')}
          </Link>
        )}
      </div>

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
