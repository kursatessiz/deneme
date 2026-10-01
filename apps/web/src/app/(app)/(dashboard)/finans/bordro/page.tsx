'use client';

import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { hasAnyPermission } from '@/lib/nav';
import { PageGuard } from '@/components/common/PageGuard';
import { PayrollRuns } from '@/components/finance/PayrollRuns';
import { PayrollMyLines } from '@/components/finance/PayrollMyLines';

function PayrollPageContent() {
  const { permissions, isOwner } = useDashboardSession();
  const canManage = hasAnyPermission(['commissions.view.all', 'payroll.manage'], permissions, isOwner);
  return canManage ? <PayrollRuns /> : <PayrollMyLines />;
}

export default function Page() {
  return (
    <PageGuard required={['commissions.view.all', 'payroll.manage', 'commissions.view.own']}>
      <PayrollPageContent />
    </PageGuard>
  );
}
