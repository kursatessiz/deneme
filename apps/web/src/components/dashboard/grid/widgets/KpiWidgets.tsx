'use client';

import { CHURN_RISK_LEVELS } from '@platform/shared';
import type { DashboardWidgetPayload } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/ui/Badge';
import { Comparison, KpiBody, useWidgetFormat } from './common';

type Payload<K extends DashboardWidgetPayload['kind']> = Extract<DashboardWidgetPayload, { kind: K }>;

/** Net revenue of the period in the studio currency, compared with the previous period. */
export function RevenueKpi({ data }: { data: Payload<'revenue'> }) {
  const t = useT();
  const f = useWidgetFormat();
  const value = f.money(data.currentAmount, data.currency);
  return (
    <KpiBody
      value={value}
      comparison={<Comparison change={data.change} />}
      hint={t('dashboard.kpi.previousValue', { value: f.money(data.previousAmount, data.currency) })}
    />
  );
}

export function ActiveMembersKpi({ data }: { data: Payload<'activeMembers'> }) {
  const t = useT();
  const f = useWidgetFormat();
  return (
    <KpiBody
      value={f.number(data.count)}
      hint={data.expiringPackages > 0 ? t('dashboard.kpi.expiringPackages', { count: data.expiringPackages }) : t('dashboard.kpi.noExpiring')}
    />
  );
}

export function CountComparisonKpi({ data }: { data: Payload<'newMembers'> | Payload<'newLeads'> }) {
  const t = useT();
  const f = useWidgetFormat();
  return (
    <KpiBody
      value={f.number(data.current)}
      comparison={<Comparison change={data.change} />}
      hint={t('dashboard.kpi.previousValue', { value: f.number(data.previous) })}
    />
  );
}

export function MemberGrowthKpi({ data }: { data: Payload<'memberGrowth'> }) {
  const t = useT();
  const f = useWidgetFormat();
  const change = data.rate !== null && data.previousRate !== null ? data.rate - data.previousRate : null;
  return (
    <KpiBody
      value={data.rate === null ? t('dashboard.kpi.notEnoughData') : f.signedPercent(data.rate)}
      comparison={
        change === null ? (
          <span className="ui-caption">{t('dashboard.kpi.noComparison')}</span>
        ) : (
          <span className="ui-caption truncate">{t('dashboard.kpi.previousValue', { value: f.signedPercent(data.previousRate ?? 0) })}</span>
        )
      }
      hint={t('dashboard.kpi.joinedChurned', { joined: f.number(data.joined), churned: f.number(data.churned) })}
    />
  );
}

export function OccupancyKpi({ data }: { data: Payload<'occupancy'> }) {
  const t = useT();
  const f = useWidgetFormat();
  return (
    <KpiBody
      value={f.percent(data.rate)}
      comparison={
        data.previousRate === null ? (
          <span className="ui-caption">{t('dashboard.kpi.noComparison')}</span>
        ) : (
          <span className="ui-caption truncate">{t('dashboard.kpi.previousValue', { value: f.percent(data.previousRate) })}</span>
        )
      }
      hint={t('dashboard.kpi.seats', { booked: f.number(data.booked), capacity: f.number(data.capacity) })}
    />
  );
}

export function TodaySessionsKpi({ data }: { data: Payload<'todaySessions'> }) {
  const t = useT();
  const f = useWidgetFormat();
  return (
    <KpiBody
      value={f.number(data.sessions)}
      comparison={<span className="ui-caption truncate">{t('dashboard.kpi.bookings', { count: data.bookings })}</span>}
      hint={data.cancelled > 0 ? t('dashboard.kpi.cancelledSessions', { count: data.cancelled }) : t('dashboard.kpi.seats', { booked: f.number(data.bookings), capacity: f.number(data.capacity) })}
    />
  );
}

export function RenewalKpi({ data }: { data: Payload<'renewalRate'> }) {
  const t = useT();
  const f = useWidgetFormat();
  return (
    <KpiBody
      value={data.expired === 0 ? t('dashboard.kpi.notEnoughData') : f.percent(data.rate)}
      comparison={
        data.previousRate === null ? (
          <span className="ui-caption">{t('dashboard.kpi.noComparison')}</span>
        ) : (
          <span className="ui-caption truncate">{t('dashboard.kpi.previousValue', { value: f.percent(data.previousRate) })}</span>
        )
      }
      hint={t('dashboard.kpi.renewed', { renewed: f.number(data.renewed), expired: f.number(data.expired) })}
    />
  );
}

/** High risk members up front, the three levels as small badges, the last computation time as a hint. */
export function ChurnKpi({ data }: { data: Payload<'churnRisk'> }) {
  const t = useT();
  const f = useWidgetFormat();
  const high = data.counts.find((c) => c.level === 'HIGH');
  return (
    <div className="grid gap-1 content-start min-w-0">
      <span className="ui-kpi-value">{f.number(high?.count ?? 0)}</span>
      <div className="flex flex-wrap gap-1 min-w-0">
        {[...CHURN_RISK_LEVELS].reverse().map((level) => {
          const row = data.counts.find((c) => c.level === level);
          return (
            <Badge key={level} tone={level === 'HIGH' ? 'error' : level === 'MEDIUM' ? 'warn' : 'muted'}>
              {t(`churn.level.${level}`)} {f.number(row?.count ?? 0)}
            </Badge>
          );
        })}
      </div>
      <div className="ui-caption ui-kpi-hint truncate">
        {data.computedAt ? t('dashboard.kpi.computedAt', { date: f.day(data.computedAt) }) : t('dashboard.kpi.notComputed')}
      </div>
    </div>
  );
}
