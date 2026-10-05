'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { DashboardWidgetPayload } from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { useWidgetFormat } from './common';

type Payload<K extends DashboardWidgetPayload['kind']> = Extract<DashboardWidgetPayload, { kind: K }>;

/**
 * Table cards. Columns marked ui-dash-col-secondary / -tertiary give way
 * through the card's container query when the card is narrow; long text
 * truncates and keeps the full value in its title.
 */

function Cell({ text, caption }: { text: string; caption?: string | null }) {
  return (
    <span className="grid min-w-0">
      <span className="truncate" title={text}>
        {text}
      </span>
      {caption ? (
        <span className="ui-caption truncate" title={caption}>
          {caption}
        </span>
      ) : null}
    </span>
  );
}

export function SessionsTable({ data, withDay, emptyKey }: { data: Payload<'sessions'>; withDay: boolean; emptyKey: string }) {
  const t = useT();
  const f = useWidgetFormat();
  const locale = useLocale();
  // Session times are shown on the studio's clock.
  const time = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, withDay ? { timeZone: data.timeZone, weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { timeZone: data.timeZone, hour: '2-digit', minute: '2-digit' }),
    [locale, withDay, data.timeZone],
  );
  if (data.sessions.length === 0) return <EmptyState title={t(emptyKey)} className="py-6" />;
  return (
    <Table className="w-full table-fixed">
      <Thead>
        <Tr>
          <Th style={{ width: withDay ? '34%' : '18%' }}>{t('dashboard.table.time')}</Th>
          <Th>{t('dashboard.table.session')}</Th>
          <Th className="ui-dash-col-secondary">{t('dashboard.table.trainer')}</Th>
          <Th className="ui-dash-col-tertiary">{t('dashboard.table.place')}</Th>
          <Th style={{ width: '5.5rem' }} className="text-end">
            {t('dashboard.table.spots')}
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {data.sessions.map((s) => {
          const full = s.booked >= s.capacity;
          return (
            <Tr key={s.id}>
              <Td className="ui-tabular">
                <span className="block truncate">{time.format(new Date(s.startTime))}</span>
              </Td>
              <Td>
                <Cell text={s.title} caption={s.serviceTypeName} />
              </Td>
              <Td className="ui-dash-col-secondary">
                <Cell text={s.trainerName ?? t('dashboard.table.none')} />
              </Td>
              <Td className="ui-dash-col-tertiary">
                <Cell text={s.resourceName ?? s.branchName ?? t('dashboard.table.none')} />
              </Td>
              <Td className="text-end">
                {s.isCancelled ? (
                  <Badge tone="error">{t('dashboard.table.cancelled')}</Badge>
                ) : (
                  <Badge tone={full ? 'warn' : 'muted'}>{full ? t('dashboard.table.full') : `${f.number(s.booked)}/${f.number(s.capacity)}`}</Badge>
                )}
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
}

export function PaymentsTable({ data }: { data: Payload<'recentPayments'> }) {
  const t = useT();
  const f = useWidgetFormat();
  if (data.payments.length === 0) return <EmptyState title={t('dashboard.empty.payments')} className="py-6" />;
  return (
    <Table className="w-full table-fixed">
      <Thead>
        <Tr>
          <Th style={{ width: '24%' }}>{t('dashboard.table.date')}</Th>
          <Th>{t('dashboard.table.payer')}</Th>
          <Th className="ui-dash-col-secondary">{t('dashboard.table.method')}</Th>
          <Th style={{ width: '32%' }} className="text-end">
            {t('dashboard.table.amount')}
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {data.payments.map((p) => {
          const amount = f.money(p.amount, p.currency);
          return (
            <Tr key={p.id}>
              <Td className="ui-tabular">
                <span className="block truncate">{f.day(p.paidAt)}</span>
              </Td>
              <Td>
                <Cell text={p.payerName ?? t('dashboard.table.guest')} />
              </Td>
              <Td className="ui-dash-col-secondary">
                <Cell text={t(`finance.method.${p.paymentMethod}`)} />
              </Td>
              <Td className="text-end ui-tabular">
                <span className="block truncate" title={amount}>
                  {amount}
                </span>
                {p.paymentStatus !== 'COMPLETED' ? <span className="ui-caption block truncate">{t(`dashboard.paymentStatus.${p.paymentStatus}`)}</span> : null}
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
}

export function ExpiringPackagesTable({ data }: { data: Payload<'expiringPackages'> }) {
  const t = useT();
  const f = useWidgetFormat();
  if (data.packages.length === 0) return <EmptyState title={t('dashboard.empty.expiring', { days: data.withinDays })} className="py-6" />;
  return (
    <Table className="w-full table-fixed">
      <Thead>
        <Tr>
          <Th>{t('dashboard.table.member')}</Th>
          <Th className="ui-dash-col-secondary">{t('dashboard.table.package')}</Th>
          <Th style={{ width: '26%' }}>{t('dashboard.table.ends')}</Th>
          <Th style={{ width: '18%' }} className="text-end ui-dash-col-tertiary">
            {t('dashboard.table.left')}
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {data.packages.map((p) => (
          <Tr key={p.memberPackageId}>
            <Td>
              <Link href={`/members/${p.memberId}`} className="pui-link pui-surface block truncate" title={p.memberName}>
                {p.memberName}
              </Link>
            </Td>
            <Td className="ui-dash-col-secondary">
              <Cell text={p.packageName} />
            </Td>
            <Td className="ui-tabular">
              <span className="block truncate">{f.day(p.endDate)}</span>
            </Td>
            <Td className="text-end ui-tabular ui-dash-col-tertiary">{p.remainingUnits === null ? t('dashboard.table.unlimited') : f.number(p.remainingUnits)}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}

export function TrainerTable({ data }: { data: Payload<'trainerPerformance'> }) {
  const t = useT();
  const f = useWidgetFormat();
  if (data.trainers.length === 0) return <EmptyState title={t('dashboard.empty.trainers')} className="py-6" />;
  return (
    <Table className="w-full table-fixed">
      <Thead>
        <Tr>
          <Th>{t('dashboard.table.trainer')}</Th>
          <Th style={{ width: '16%' }} className="text-end">
            {t('dashboard.table.sessions')}
          </Th>
          <Th style={{ width: '22%' }} className="text-end">
            {t('dashboard.table.occupancy')}
          </Th>
          <Th style={{ width: '16%' }} className="text-end ui-dash-col-secondary">
            {t('dashboard.table.noShows')}
          </Th>
          <Th style={{ width: '18%' }} className="text-end ui-dash-col-tertiary">
            {t('dashboard.table.lateCancellations')}
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {data.trainers.map((row) => (
          <Tr key={row.trainerProfileId}>
            <Td>
              <Cell text={row.trainerName} />
            </Td>
            <Td className="text-end ui-tabular">{f.number(row.sessions)}</Td>
            <Td className="text-end ui-tabular">{f.percent(row.occupancy)}</Td>
            <Td className="text-end ui-tabular ui-dash-col-secondary">{f.number(row.noShows)}</Td>
            <Td className="text-end ui-tabular ui-dash-col-tertiary">{f.number(row.lateCancellations)}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
