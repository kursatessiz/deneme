'use client';

import { Fragment } from 'react';
import type { CSSProperties } from 'react';
import type { OccupancyReportDTO } from '@platform/shared';
import { formatPercent as formatPercentShared } from '@/lib/money';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { Bar } from './Bar';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { Card, CardContent } from '@/components/ui/Card';

type OccupancyReport = OccupancyReportDTO;

/** Reference week (an arbitrary Monday) used only to derive locale-correct short weekday labels. */
const REFERENCE_MONDAY = new Date(Date.UTC(2024, 0, 1));

function weekdayLabels(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(REFERENCE_MONDAY);
    d.setUTCDate(REFERENCE_MONDAY.getUTCDate() + i);
    return formatter.format(d);
  });
}

/** Strength of the heat cell fill in percent (0 means the muted surface); the .ui-heat class mixes the brand color in. */
function heatStrength(occupancy: number): string {
  if (occupancy <= 0) return '0%';
  return `${Math.round(Math.min(1, 0.15 + occupancy * 0.75) * 100)}%`;
}

export function OccupancyReport({ report, loading, error }: { report: OccupancyReport | null; loading: boolean; error: string | null }) {
  const t = useT();
  const locale = useLocale();
  const formatPercent = (ratio: number | null | undefined, fractionDigits?: number) => formatPercentShared(ratio, locale, fractionDigits);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!report || report.byDay.length === 0) return <EmptyState title={t('reports.empty.title')} description={t('reports.empty.rangeDescription')} />;

  const maxOccupancy = Math.max(...report.byServiceType.map((s) => s.occupancy), 0.0001);
  const labels = weekdayLabels(locale);

  return (
    <div className="grid gap-6">
      <Card>
        <CardContent>
          <h3 className="ui-heading">{t('reports.occupancy.byServiceType')}</h3>
          <div className="grid gap-2">
            {report.byServiceType.map((s) => (
              <Bar key={s.serviceTypeId} label={s.serviceTypeName} value={s.occupancy} max={maxOccupancy} valueLabel={formatPercent(s.occupancy)} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h3 className="ui-heading">{t('reports.occupancy.heatmap')}</h3>
          <div className="overflow-x-auto">
            <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `40px repeat(24, 14px)` }}>
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="ui-caption text-center">
                  {h % 3 === 0 ? h : ''}
                </div>
              ))}
              {labels.map((label, weekday) => (
                <Fragment key={weekday}>
                  <div className="ui-caption flex items-center">{label}</div>
                  {Array.from({ length: 24 }, (_, hour) => {
                    const cell = report.heatmap.find((c) => c.weekday === weekday && c.hour === hour);
                    return (
                      <div
                        key={`${weekday}-${hour}`}
                        className="ui-heat ui-heat-cell"
                        title={`${label} ${hour}:00 - ${formatPercent(cell?.occupancy ?? 0)}`}
                        style={{ '--ui-heat': heatStrength(cell?.occupancy ?? 0) } as CSSProperties}
                      />
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-2">
        <h3 className="ui-heading">{t('reports.occupancy.byDay')}</h3>
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                {[
                  t('reports.occupancy.col.date'),
                  t('reports.occupancy.col.sessions'),
                  t('reports.occupancy.col.capacity'),
                  t('reports.occupancy.col.booked'),
                  t('reports.occupancy.col.attended'),
                  t('reports.occupancy.col.occupancy'),
                ].map((h, i) => (
                  <Th key={i} className="whitespace-nowrap">
                    {h}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {report.byDay.map((d) => (
                <Tr key={d.date}>
                  <Td>{new Date(d.date).toLocaleDateString(locale)}</Td>
                  <Td>{d.sessions}</Td>
                  <Td>{d.capacity}</Td>
                  <Td>{d.booked}</Td>
                  <Td>{d.attended}</Td>
                  <Td className="ui-strong">{formatPercent(d.occupancy)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
