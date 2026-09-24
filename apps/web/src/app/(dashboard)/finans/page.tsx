'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageGuard } from '@/components/common/PageGuard';
import { Tabs } from '@/components/common/Tabs';
import { PaymentsTab } from '@/components/finance/PaymentsTab';
import { ExpensesTab } from '@/components/finance/ExpensesTab';
import { InvoicesTab } from '@/components/finance/InvoicesTab';
import { PromotionsTab } from '@/components/finance/PromotionsTab';

const TABS = [
  { key: 'payments', label: 'Ödemeler' },
  { key: 'expenses', label: 'Giderler' },
  { key: 'invoices', label: 'Faturalar' },
  { key: 'promotions', label: 'Promosyon ve Hediye Kartı' },
] as const;

function FinancePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('payments');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            Finans
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Ödemeler, giderler, faturalar, promosyon kodları ve hediye kartları
          </p>
        </div>
        <Link href="/finans/bordro" className="text-sm font-medium hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
          Hakediş ve bordro
        </Link>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={(k) => setTab(k as (typeof TABS)[number]['key'])} />

      {tab === 'payments' && <PaymentsTab />}
      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'promotions' && <PromotionsTab />}
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['finance.view', 'finance.manage', 'promotions.manage']}>
      <FinancePage />
    </PageGuard>
  );
}
