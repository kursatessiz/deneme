'use client';

import { PageGuard } from '@/components/common/PageGuard';
import { useT } from '@/components/i18n/I18nProvider';
import { PayoutsView } from '@/components/finance/PayoutsView';
import { LinkButton } from '@/components/ui/LinkButton';
import { PageHeader } from '@/components/ui/PageHeader';

function PayoutsPage() {
  const t = useT();
  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('payouts.title')}
        description={t('payouts.subtitle')}
        actions={
          <LinkButton href="/finans" variant="outline" tone="surface" size="sm">
            {t('payouts.backToFinance')}
          </LinkButton>
        }
      />
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
