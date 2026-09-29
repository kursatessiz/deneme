'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageGuard } from '@/components/common/PageGuard';
import { Tabs } from '@/components/common/Tabs';
import { useT } from '@/components/i18n/I18nProvider';
import { PaymentsTab } from '@/components/finance/PaymentsTab';
import { ExpensesTab } from '@/components/finance/ExpensesTab';
import { InvoicesTab } from '@/components/finance/InvoicesTab';
import { PromotionsTab } from '@/components/finance/PromotionsTab';
import { AccountingExportCard } from '@/components/finance/AccountingExportCard';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { hasAnyPermission } from '@/lib/nav';
import type { PermissionKey } from '@platform/shared';

/** A link shown only to members holding one of the permissions (owners always). */
function PermissionLink({ permissions, href, children }: { permissions: readonly PermissionKey[]; href: string; children: React.ReactNode }) {
  const { permissions: held, isOwner } = useDashboardSession();
  if (!hasAnyPermission(permissions, held, isOwner)) return null;
  return (
    <Link href={href} className="text-sm font-medium hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
      {children}
    </Link>
  );
}

const TAB_KEYS = ['payments', 'expenses', 'invoices', 'promotions'] as const;

function FinancePage() {
  const t = useT();
  const [tab, setTab] = useState<(typeof TAB_KEYS)[number]>('payments');
  const tabs = TAB_KEYS.map((key) => ({ key, label: t(`finance.tabs.${key}`) }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            {t('finance.title')}
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {t('finance.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <PermissionLink permissions={['payouts.view']} href="/finans/odemeler">
            {t('finance.payoutsLink')}
          </PermissionLink>
          <Link href="/finans/bordro" className="text-sm font-medium hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
            {t('finance.payrollLink')}
          </Link>
        </div>
      </div>

      <AccountingExportCard />

      <Tabs tabs={tabs} active={tab} onChange={(k) => setTab(k as (typeof TAB_KEYS)[number])} />

      {tab === 'payments' && <PaymentsTab />}
      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'promotions' && <PromotionsTab />}
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['finance.view', 'finance.manage', 'promotions.manage', 'accounting.export']}>
      <FinancePage />
    </PageGuard>
  );
}
