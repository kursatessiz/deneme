'use client';

import { useState } from 'react';
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
import { LinkButton } from '@/components/ui/LinkButton';
import { PageHeader } from '@/components/ui/PageHeader';

/** A link shown only to members holding one of the permissions (owners always). */
function PermissionLink({ permissions, href, children }: { permissions: readonly PermissionKey[]; href: string; children: React.ReactNode }) {
  const { permissions: held, isOwner } = useDashboardSession();
  if (!hasAnyPermission(permissions, held, isOwner)) return null;
  return (
    <LinkButton href={href} variant="outline" tone="surface" size="sm">
      {children}
    </LinkButton>
  );
}

const TAB_KEYS = ['payments', 'expenses', 'invoices', 'promotions'] as const;

function FinancePage() {
  const t = useT();
  const [tab, setTab] = useState<(typeof TAB_KEYS)[number]>('payments');
  const tabs = TAB_KEYS.map((key) => ({ key, label: t(`finance.tabs.${key}`) }));

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('finance.title')}
        description={t('finance.subtitle')}
        actions={
          <>
            <PermissionLink permissions={['payouts.view']} href="/finans/odemeler">
              {t('finance.payoutsLink')}
            </PermissionLink>
            <LinkButton href="/finans/bordro" variant="outline" tone="surface" size="sm">
              {t('finance.payrollLink')}
            </LinkButton>
          </>
        }
      />

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
