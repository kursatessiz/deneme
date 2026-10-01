'use client';

import { CalendarCheck, Gauge, Users, Wallet } from 'lucide-react';
import type { DashboardMetricsDTO } from '@platform/shared';
import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { hasAnyPermission } from '@/lib/nav';
import { StatTile } from '@/components/ui/StatTile';
import { Skeleton } from '@/components/ui/Skeleton';

function MetricsTiles() {
  const t = useT();
  const locale = useLocale();
  const formatMoney = useFormatMoney();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<DashboardMetricsDTO>(`studios/${activeStudioId}/metrics`, activeStudioId);
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });

  if (error) return null;
  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height="7rem" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <StatTile
        label={t('screens.dashboard.stats.todaySessions')}
        value={number.format(data.todaySessionsCount)}
        hint={`${t('screens.dashboard.stats.todayBookings')}: ${number.format(data.todayAttendeesCount)}`}
        icon={<CalendarCheck className="ui-icon" aria-hidden="true" />}
      />
      <StatTile
        label={t('screens.dashboard.stats.occupancy')}
        value={percent.format(data.occupancyRate / 100)}
        icon={<Gauge className="ui-icon" aria-hidden="true" />}
        tone="success"
      />
      <StatTile
        label={t('screens.dashboard.stats.activeMembers')}
        value={number.format(data.activeMembersCount)}
        hint={data.expiringPackagesCount > 0 ? t('screens.dashboard.stats.expiringPackages', { count: data.expiringPackagesCount }) : undefined}
        icon={<Users className="ui-icon" aria-hidden="true" />}
        tone={data.expiringPackagesCount > 0 ? 'warn' : 'theme'}
      />
      <StatTile
        label={t('screens.dashboard.stats.monthlyRevenue')}
        value={formatMoney(data.monthlyRevenue)}
        icon={<Wallet className="ui-icon" aria-hidden="true" />}
      />
    </div>
  );
}

/** The dashboard's figures (GET studios/:id/metrics); only for memberships that may see reports. */
export function DashboardStats() {
  const { permissions, isOwner } = useDashboardSession();
  if (!hasAnyPermission(['reports.view'], permissions, isOwner)) return null;
  return <MetricsTiles />;
}
