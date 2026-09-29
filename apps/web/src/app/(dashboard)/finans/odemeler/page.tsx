'use client';

import Link from 'next/link';
import { PageGuard } from '@/components/common/PageGuard';
import { useT } from '@/components/i18n/I18nProvider';
import { PayoutsView } from '@/components/finance/PayoutsView';

function PayoutsPage() {
  const t = useT();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            {t('payouts.title')}
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {t('payouts.subtitle')}
          </p>
        </div>
        <Link href="/finans" className="text-sm font-medium hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
          {t('payouts.backToFinance')}
        </Link>
      </div>
      <PayoutsView />
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['payouts.view']}>
      <PayoutsPage />
    </PageGuard>
  );
}
