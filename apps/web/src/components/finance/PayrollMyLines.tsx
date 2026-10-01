'use client';

import type { PayrollLineDTO } from '@platform/shared';
import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { formatMoney, sumMoney } from '@/lib/money';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';

type MyPayrollLine = PayrollLineDTO;

/** A trainer who only has commissions.view.own sees their own approved/paid lines instead of the full run list. */
export function PayrollMyLines() {
  const t = useT();
  const formatMoney = useFormatMoney();
  const { activeStudioId } = useDashboardSession();
  const { data: lines, loading, error } = useBff<MyPayrollLine[]>(`payroll/studio/${activeStudioId}/me/lines`, activeStudioId);

  return (
    <div className="space-y-4">
      <PageHeader title={t('finance.payroll.myTitle')} description={t('finance.payroll.mySubtitle')} />

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!lines || lines.length === 0) && <EmptyState title={t('finance.payroll.myEmpty')} />}
      {!loading && !error && lines && lines.length > 0 && (
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                {[
                  t('finance.payroll.col.sessions'),
                  t('finance.payroll.col.attendees'),
                  t('finance.payroll.col.gross'),
                  t('finance.payroll.col.adjustment'),
                  t('finance.payroll.col.net'),
                ].map((h, i) => (
                  <Th key={i} className="whitespace-nowrap">
                    {h}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {lines.map((l) => (
                <Tr key={l.id}>
                  <Td>{l.sessions}</Td>
                  <Td>{l.attendees}</Td>
                  <Td>{formatMoney(l.grossAmount)}</Td>
                  <Td>{formatMoney(l.adjustments)}</Td>
                  <Td className="ui-strong">{formatMoney(l.netAmount)}</Td>
                </Tr>
              ))}
            </Tbody>
            <tfoot>
              <Tr>
                <Td colSpan={4} className="ui-strong text-right">
                  {t('finance.payroll.totalNet')}
                </Td>
                <Td className="ui-strong">{formatMoney(sumMoney(lines.map((l) => l.netAmount)))}</Td>
              </Tr>
            </tfoot>
          </Table>
        </Card>
      )}
    </div>
  );
}
