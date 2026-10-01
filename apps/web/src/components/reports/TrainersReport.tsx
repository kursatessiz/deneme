'use client';

import type { TrainerReportDTO } from '@platform/shared';
import { formatPercent as formatPercentShared } from '@/lib/money';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';

type TrainersReport = TrainerReportDTO;

export function TrainersReport({ report, loading, error }: { report: TrainersReport | null; loading: boolean; error: string | null }) {
  const t = useT();
  const locale = useLocale();
  const formatPercent = (ratio: number | null | undefined, fractionDigits?: number) => formatPercentShared(ratio, locale, fractionDigits);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report || report.trainers.length === 0) return <EmptyState title={t('reports.empty.title')} />;

  return (
    <Card className="overflow-x-auto">
      <Table>
        <Thead>
          <Tr>
            {[
              t('reports.trainers.col.trainer'),
              t('reports.trainers.col.sessions'),
              t('reports.trainers.col.booked'),
              t('reports.trainers.col.attended'),
              t('reports.trainers.col.occupancy'),
              t('reports.trainers.col.noShows'),
              t('reports.trainers.col.lateCancellations'),
              t('reports.trainers.col.substitutions'),
            ].map((h, i) => (
              <Th key={i} className="whitespace-nowrap">
                {h}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {report.trainers.map((row) => (
            <Tr key={row.trainerProfileId}>
              <Td>{row.trainerName}</Td>
              <Td>{row.sessions}</Td>
              <Td>{row.booked}</Td>
              <Td>{row.attended}</Td>
              <Td className="ui-strong">{formatPercent(row.occupancy)}</Td>
              <Td>{row.noShows}</Td>
              <Td>{row.lateCancellations}</Td>
              <Td>{row.substitutions}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Card>
  );
}
