'use client';

import { useParams } from 'next/navigation';
import { PageGuard } from '@/components/common/PageGuard';
import { SaleReceipt } from '@/components/retail/SaleReceipt';

/** One desk sale: printable receipt, refunds and void (G3c-2). */
export default function Page() {
  const params = useParams<{ saleId: string }>();
  return (
    <PageGuard required={['retail.view']}>
      <SaleReceipt saleId={params.saleId} />
    </PageGuard>
  );
}
