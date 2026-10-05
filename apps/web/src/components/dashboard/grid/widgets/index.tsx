'use client';

import { RotateCw } from 'lucide-react';
import { getDashboardWidget, type DashboardLayoutItem, type DashboardWidgetKey, type DashboardWidgetPayload } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { visibleQuickActions } from '@/lib/quick-actions';
import type { WidgetDataState } from '@/lib/dashboard/use-dashboard-data';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { QuickActionBar } from '../../QuickActionBar';
import { ActiveMembersKpi, ChurnKpi, CountComparisonKpi, MemberGrowthKpi, OccupancyKpi, RenewalKpi, RevenueKpi, TodaySessionsKpi } from './KpiWidgets';
import { MemberGrowthChart, OccupancyTrendChart, RevenueTrendChart } from './ChartWidgets';
import { ExpiringPackagesTable, PaymentsTable, SessionsTable, TrainerTable } from './TableWidgets';
import { WeekCalendar } from './WeekCalendar';
import { BranchList, EventList, LowStockList } from './OperationsWidgets';

/** How a card is framed: an optional link in its header (to the screen behind it) and whether its body runs edge to edge. */
export interface WidgetView {
  link?: { href: string; labelKey: string };
  flush?: boolean;
  /** Title and content share one row (the one row high quick actions card). */
  inline?: boolean;
}

export const WIDGET_VIEWS: Record<DashboardWidgetKey, WidgetView> = {
  revenue: {},
  activeMembers: {},
  newMembers: {},
  memberGrowth: {},
  occupancy: {},
  todaySessions: {},
  renewalRate: {},
  churnRisk: { link: { href: '/riskli-uyeler', labelKey: 'dashboard.link.open' } },
  newLeads: {},
  revenueTrend: { link: { href: '/raporlar', labelKey: 'dashboard.link.reports' } },
  occupancyTrend: { link: { href: '/raporlar', labelKey: 'dashboard.link.reports' } },
  memberGrowthChart: {},
  todaySchedule: { link: { href: '/calendar', labelKey: 'screens.dashboard.today.openCalendar' }, flush: true },
  upcomingSessions: { link: { href: '/calendar', labelKey: 'screens.dashboard.today.openCalendar' }, flush: true },
  recentPayments: { link: { href: '/finans', labelKey: 'dashboard.link.open' }, flush: true },
  expiringPackages: { link: { href: '/members', labelKey: 'dashboard.link.open' }, flush: true },
  trainerPerformance: { link: { href: '/raporlar', labelKey: 'dashboard.link.reports' }, flush: true },
  weekCalendar: { link: { href: '/calendar', labelKey: 'screens.dashboard.today.openCalendar' } },
  branches: { flush: true },
  lowStock: { link: { href: '/magaza', labelKey: 'retail.lowStock.manage' }, flush: true },
  upcomingEvents: { link: { href: '/etkinlikler', labelKey: 'dashboard.link.open' }, flush: true },
  quickActions: { inline: true },
};

function LoadingBody({ widget }: { widget: DashboardWidgetKey }) {
  const { category } = getDashboardWidget(widget);
  if (category === 'metrics') {
    return (
      <div className="grid gap-2" aria-hidden="true">
        <Skeleton height="2rem" width="60%" />
        <Skeleton height="0.875rem" width="80%" />
      </div>
    );
  }
  return (
    <div className="grid gap-2 px-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height="1.75rem" />
      ))}
    </div>
  );
}

function Payload({ item, data }: { item: DashboardLayoutItem; data: DashboardWidgetPayload }) {
  switch (data.kind) {
    case 'revenue':
      return <RevenueKpi data={data} />;
    case 'activeMembers':
      return <ActiveMembersKpi data={data} />;
    case 'newMembers':
    case 'newLeads':
      return <CountComparisonKpi data={data} />;
    case 'memberGrowth':
      return <MemberGrowthKpi data={data} />;
    case 'occupancy':
      return <OccupancyKpi data={data} />;
    case 'todaySessions':
      return <TodaySessionsKpi data={data} />;
    case 'renewalRate':
      return <RenewalKpi data={data} />;
    case 'churnRisk':
      return <ChurnKpi data={data} />;
    case 'revenueTrend':
      return <RevenueTrendChart data={data} />;
    case 'occupancyTrend':
      return <OccupancyTrendChart data={data} />;
    case 'memberGrowthChart':
      return <MemberGrowthChart data={data} />;
    case 'sessions':
      if (item.widget === 'weekCalendar') return <WeekCalendar data={data} />;
      return (
        <SessionsTable
          data={data}
          withDay={item.widget === 'upcomingSessions'}
          emptyKey={item.widget === 'upcomingSessions' ? 'dashboard.empty.upcoming' : 'screens.dashboard.today.empty'}
        />
      );
    case 'recentPayments':
      return <PaymentsTable data={data} />;
    case 'expiringPackages':
      return <ExpiringPackagesTable data={data} />;
    case 'trainerPerformance':
      return <TrainerTable data={data} />;
    case 'branches':
      return <BranchList data={data} />;
    case 'lowStock':
      return <LowStockList data={data} />;
    case 'upcomingEvents':
      return <EventList data={data} />;
    case 'none':
    default:
      return null;
  }
}

function QuickActionsBody() {
  const t = useT();
  const { permissions, isOwner } = useDashboardSession();
  if (visibleQuickActions(permissions, isOwner).length === 0) return <p className="ui-caption">{t('dashboard.empty.quickActions')}</p>;
  return <QuickActionBar />;
}

/** The body of one card: its loading, error, forbidden or data state. */
export function WidgetContent({ item, state, onRetry }: { item: DashboardLayoutItem; state: WidgetDataState; onRetry: () => void }) {
  const t = useT();
  if (item.widget === 'quickActions') return <QuickActionsBody />;
  if (state.status === 'loading') return <LoadingBody widget={item.widget} />;
  if (state.status === 'forbidden') return <EmptyState title={t('dashboard.state.forbidden')} className="py-4" />;
  if (state.status === 'error') {
    return (
      <div className="grid gap-2 justify-items-start px-3">
        <p className="ui-text-error ui-small">{t('dashboard.state.error')}</p>
        <Button size="sm" variant="outline" tone="surface" icon={<RotateCw className="ui-icon" aria-hidden="true" />} onClick={onRetry}>
          {t('dashboard.state.retry')}
        </Button>
      </div>
    );
  }
  return <Payload item={item} data={state.data} />;
}
