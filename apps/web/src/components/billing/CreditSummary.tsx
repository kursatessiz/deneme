'use client';

import type { CreditBalance } from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { formatMoney } from '@/lib/money';

/** Subscription credit (G5c-1): money per currency plus free months, or "no credit". */
export function CreditSummary({ credit }: { credit: CreditBalance }) {
  const t = useT();
  const locale = useLocale();
  if (credit.amounts.length === 0 && credit.months === 0) return <>{t('billing.summary.noCredit')}</>;
  const parts = [
    ...credit.amounts.map((a) => formatMoney(a.amount, a.currency, locale)),
    ...(credit.months > 0 ? [t('billing.summary.creditMonths', { count: credit.months })] : []),
  ];
  return <>{parts.join(' + ')}</>;
}
