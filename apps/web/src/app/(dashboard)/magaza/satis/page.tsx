'use client';

import { LinkButton, PageHeader } from '@/components/ui';
import { PageGuard } from '@/components/common/PageGuard';
import { useT } from '@/components/i18n/I18nProvider';
import { QuickSale } from '@/components/retail/QuickSale';

/** Quick sale (G3c-2): the front desk's point of sale for products and add-ons. */
function QuickSalePage() {
  const t = useT();
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('retail.pos.title')}
        description={t('retail.pos.subtitle')}
        actions={
          <LinkButton href="/magaza" variant="link" tone="surface" size="sm">
            {t('retail.title')}
          </LinkButton>
        }
      />
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
