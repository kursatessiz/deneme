'use client';

import type { CohortReportDTO } from '@platform/shared';
import { formatPercent as formatPercentShared } from '@/lib/money';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { CSSProperties } from 'react';

type CohortsReport = CohortReportDTO;

/** Strength of the heat cell fill in percent (0 means the muted surface); the .ui-heat class mixes the brand color in. */
function cellStrength(ratio: number): string {
  if (ratio <= 0) return '0%';
  return `${Math.round(Math.min(1, 0.12 + ratio * 0.7) * 100)}%`;
}

export function CohortsReport({ report, loading, error }: { report: CohortsReport | null; loading: boolean; error: string | null }) {
  const t = useT();
  const locale = useLocale();
  const formatPercent = (ratio: number | null | undefined, fractionDigits?: number) => formatPercentShared(ratio, locale, fractionDigits);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report || report.cohorts.length === 0) return <EmptyState title={t('reports.empty.title')} description={t('reports.empty.cohortDescription')} />;

  const maxMonths = Math.max(...report.cohorts.map((c) => c.retention.length));

  return (
    <Card className="overflow-x-auto">
      <Table>
        <Thead>
          <Tr>
            <Th className="sticky left-0">{t('reports.cohorts.col.cohort')}</Th>
            <Th>{t('reports.cohorts.col.members')}</Th>
            {Array.from({ length: maxMonths }, (_, i) => (
              <Th key={i} className="text-center">
                {t('reports.cohorts.col.month', { index: i })}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {report.cohorts.map((c) => (
            <Tr key={c.cohortMonth}>
              <Td className="ui-strong sticky left-0">{c.cohortMonth}</Td>
              <Td>{c.cohortSize}</Td>
              {Array.from({ length: maxMonths }, (_, i) => {
                const ratio = c.retention[i];
                return (
                  <Td key={i} className="text-center">
                    {ratio !== undefined ? (
                      <Badge className="ui-heat" style={{ '--ui-heat': cellStrength(ratio) } as CSSProperties}>
                        {formatPercent(ratio)}
                      </Badge>
                    ) : (
                      ''
                    )}
                  </Td>
                );
              })}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Card>
  );
}
