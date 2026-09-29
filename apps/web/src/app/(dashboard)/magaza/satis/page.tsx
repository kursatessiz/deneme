'use client';

import Link from 'next/link';
import { PageGuard } from '@/components/common/PageGuard';
import { useT } from '@/components/i18n/I18nProvider';
import { QuickSale } from '@/components/retail/QuickSale';

/** Quick sale (G3c-2): the front desk's point of sale for products and add-ons. */
function QuickSalePage() {
  const t = useT();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            {t('retail.pos.title')}
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {t('retail.pos.subtitle')}
          </p>
        </div>
        <Link href="/magaza" className="text-sm font-medium hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
          {t('retail.title')}
        </Link>
      </div>
      <QuickSale />
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['retail.sell']}>
      <QuickSalePage />
    </PageGuard>
  );
}
