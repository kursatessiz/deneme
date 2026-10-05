import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { CHURN_RISK_LEVELS } from '@platform/shared';
import type { DashboardLayoutItem, DashboardWidgetPayload } from '@platform/shared';

import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ListRow } from '../components/ListRow';
import { Skeleton } from '../components/Skeleton';
import { Text } from '../components/Text';
import { formatCurrency, formatDate, formatNumber, formatTime, useLocale, useT } from '../i18n';
import { visibleMobileQuickActions } from '../lib/dashboardBoard';
import { useSession } from '../lib/session';
import { borderWidth, spacing, typography, useTheme, useThemeFonts } from '../theme';
import { TrendChart } from './TrendChart';
import type { WidgetDataState } from './useDashboardBoard';

type Payload<K extends DashboardWidgetPayload['kind']> = Extract<DashboardWidgetPayload, { kind: K }>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Locale bound formatters; currencies always come from the payload. */
function useBoardFormat() {
  const { locale } = useLocale();
  return useMemo(
    () => ({
      number: (value: number) => formatNumber(value, locale),
      percent: (ratio: number) => formatNumber(ratio, locale, { style: 'percent', maximumFractionDigits: 1 }),
      signedPercent: (ratio: number) => formatNumber(ratio, locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }),
      money: (amount: string, currency: string) => formatCurrency(Number(amount), locale, currency, { maximumFractionDigits: 0 }),
      compactMoney: (amount: number, currency: string) => formatCurrency(amount, locale, currency, { notation: 'compact', maximumFractionDigits: 1 }),
      day: (iso: string) => formatDate(iso, locale, { day: 'numeric', month: 'short' }),
      dayTime: (iso: string) => formatDate(iso, locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      dateKey: (key: string) => formatDate(`${key}T00:00:00Z`, locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      monthKey: (key: string) => formatDate(`${key}-01T00:00:00Z`, locale, { month: 'short', timeZone: 'UTC' }),
      time: (iso: string, timeZone: string) => formatTime(iso, locale, { timeZone }),
      dayHeading: (date: Date, timeZone: string) => formatDate(date, locale, { timeZone, weekday: 'long', day: 'numeric', month: 'short' }),
      dayKey: (date: Date, timeZone: string) => formatDate(date, 'en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }),
    }),
    [locale],
  );
}

type BoardFormat = ReturnType<typeof useBoardFormat>;

function Muted({ children }: { children: string }) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  return <Text style={[styles.muted, fonts.body, { color: theme.colors.textMuted }]}>{children}</Text>;
}

/** The figure of a KPI card with its comparison and a hint line. */
function Kpi({ value, comparison, hint }: { value: string; comparison?: string | null; hint?: string }) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiValue, fonts.display, { color: c.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {comparison ? <Text style={[styles.kpiLine, fonts.bodyMedium, { color: c.textSecondary }]}>{comparison}</Text> : null}
      {hint ? <Text style={[styles.muted, fonts.body, { color: c.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

/** A period comparison line: signed change and "vs previous period"; muted text without a base. */
function comparisonLine(change: number | null, f: BoardFormat, t: ReturnType<typeof useT>): string {
  if (change === null || !Number.isFinite(change)) return t('dashboard.kpi.noComparison');
  return `${f.signedPercent(change)} ${t('dashboard.kpi.vsPrevious')}`;
}

function ratioComparison(previousRate: number | null, f: BoardFormat, t: ReturnType<typeof useT>): string {
  return previousRate === null ? t('dashboard.kpi.noComparison') : t('dashboard.kpi.previousValue', { value: f.percent(previousRate) });
}

function KpiBody({ data }: { data: Payload<'revenue' | 'activeMembers' | 'newMembers' | 'newLeads' | 'memberGrowth' | 'occupancy' | 'todaySessions' | 'renewalRate'> }) {
  const t = useT();
  const f = useBoardFormat();
  switch (data.kind) {
    case 'revenue':
      return (
        <Kpi
          value={f.money(data.currentAmount, data.currency)}
          comparison={comparisonLine(data.change, f, t)}
          hint={t('dashboard.kpi.previousValue', { value: f.money(data.previousAmount, data.currency) })}
        />
      );
    case 'activeMembers':
      return (
        <Kpi
          value={f.number(data.count)}
          hint={data.expiringPackages > 0 ? t('dashboard.kpi.expiringPackages', { count: data.expiringPackages }) : t('dashboard.kpi.noExpiring')}
        />
      );
    case 'newMembers':
    case 'newLeads':
      return <Kpi value={f.number(data.current)} comparison={comparisonLine(data.change, f, t)} hint={t('dashboard.kpi.previousValue', { value: f.number(data.previous) })} />;
    case 'memberGrowth':
      return (
        <Kpi
          value={data.rate === null ? t('dashboard.kpi.notEnoughData') : f.signedPercent(data.rate)}
          comparison={data.rate !== null && data.previousRate !== null ? t('dashboard.kpi.previousValue', { value: f.signedPercent(data.previousRate) }) : t('dashboard.kpi.noComparison')}
          hint={t('dashboard.kpi.joinedChurned', { joined: f.number(data.joined), churned: f.number(data.churned) })}
        />
      );
    case 'occupancy':
      return (
        <Kpi
          value={f.percent(data.rate)}
          comparison={ratioComparison(data.previousRate, f, t)}
          hint={t('dashboard.kpi.seats', { booked: f.number(data.booked), capacity: f.number(data.capacity) })}
        />
      );
    case 'todaySessions':
      return (
        <Kpi
          value={f.number(data.sessions)}
          comparison={t('dashboard.kpi.bookings', { count: data.bookings })}
          hint={data.cancelled > 0 ? t('dashboard.kpi.cancelledSessions', { count: data.cancelled }) : t('dashboard.kpi.seats', { booked: f.number(data.bookings), capacity: f.number(data.capacity) })}
        />
      );
    case 'renewalRate':
      return (
        <Kpi
          value={data.expired === 0 ? t('dashboard.kpi.notEnoughData') : f.percent(data.rate)}
          comparison={ratioComparison(data.previousRate, f, t)}
          hint={t('dashboard.kpi.renewed', { renewed: f.number(data.renewed), expired: f.number(data.expired) })}
        />
      );
  }
}

function ChurnBody({ data }: { data: Payload<'churnRisk'> }) {
  const t = useT();
  const f = useBoardFormat();
  const high = data.counts.find((c) => c.level === 'HIGH');
  return (
    <View style={styles.kpi}>
      <Kpi
        value={f.number(high?.count ?? 0)}
        hint={data.computedAt ? t('dashboard.kpi.computedAt', { date: f.day(data.computedAt) }) : t('dashboard.kpi.notComputed')}
      />
      <View style={styles.badges}>
        {[...CHURN_RISK_LEVELS].reverse().map((level) => (
          <Badge
            key={level}
            tone={level === 'HIGH' ? 'error' : level === 'MEDIUM' ? 'warn' : 'muted'}
            label={`${t(`churn.level.${level}`)} ${f.number(data.counts.find((c) => c.level === level)?.count ?? 0)}`}
          />
        ))}
      </View>
    </View>
  );
}

function SessionRows({ data, withDay, emptyKey }: { data: Payload<'sessions'>; withDay: boolean; emptyKey: 'screens.dashboard.today.empty' | 'dashboard.empty.upcoming' }) {
  const t = useT();
  const f = useBoardFormat();
  const { locale } = useLocale();
  if (data.sessions.length === 0) return <EmptyState title={t(emptyKey)} />;
  return (
    <View>
      {data.sessions.map((s, index) => {
        const full = s.booked >= s.capacity;
        const when = withDay ? formatDate(s.startTime, locale, { timeZone: data.timeZone, weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : f.time(s.startTime, data.timeZone);
        const detail = [s.trainerName, s.resourceName ?? s.branchName].filter((part): part is string => Boolean(part)).join(' - ');
        return (
          <ListRow
            key={s.id}
            title={`${when}  ${s.title}`}
            subtitle={detail || undefined}
            trailing={
              s.isCancelled ? (
                <Badge tone="error" label={t('dashboard.table.cancelled')} />
              ) : (
                <Badge tone={full ? 'warn' : 'muted'} label={full ? t('dashboard.table.full') : `${f.number(s.booked)}/${f.number(s.capacity)}`} />
              )
            }
            divider={index < data.sessions.length - 1}
          />
        );
      })}
    </View>
  );
}

/** Seven days from the payload's start as a compact list, on the studio's clock. */
function WeekDays({ data }: { data: Payload<'sessions'> }) {
  const t = useT();
  const f = useBoardFormat();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const start = new Date(data.from).getTime();
  // Noon of each day keeps a daylight saving hour from pushing the key into the neighbouring day.
  const days = Array.from({ length: 7 }, (_, i) => new Date(start + i * DAY_MS + DAY_MS / 2));
  const byDay = new Map<string, Payload<'sessions'>['sessions']>();
  for (const s of data.sessions) {
    const key = f.dayKey(new Date(s.startTime), data.timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  return (
    <View style={styles.week}>
      {days.map((d) => {
        const key = f.dayKey(d, data.timeZone);
        const sessions = byDay.get(key) ?? [];
        return (
          <View key={key} style={[styles.weekDay, { borderBottomColor: c.border }]}>
            <Text style={[styles.weekHead, fonts.bodyStrong, { color: c.textPrimary }]}>{f.dayHeading(d, data.timeZone)}</Text>
            {sessions.length === 0 ? <Text style={[styles.muted, fonts.body, { color: c.textMuted }]}>{t('dashboard.calendar.free')}</Text> : null}
            {sessions.map((s) => (
              <Text
                key={s.id}
                style={[styles.weekSession, fonts.body, { color: s.isCancelled ? c.textMuted : c.textSecondary, textDecorationLine: s.isCancelled ? 'line-through' : 'none' }]}
              >
                {f.time(s.startTime, data.timeZone)}  {s.title} ({f.number(s.booked)}/{f.number(s.capacity)})
              </Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return <View>{children}</View>;
}

function PaymentRows({ data }: { data: Payload<'recentPayments'> }) {
  const t = useT();
  const f = useBoardFormat();
  if (data.payments.length === 0) return <EmptyState title={t('dashboard.empty.payments')} />;
  return (
    <Rows>
      {data.payments.map((p, index) => (
        <ListRow
          key={p.id}
          title={p.payerName ?? t('dashboard.table.guest')}
          subtitle={`${f.day(p.paidAt)} - ${t(`finance.method.${p.paymentMethod}`)}${p.paymentStatus !== 'COMPLETED' ? ` - ${t(`dashboard.paymentStatus.${p.paymentStatus}`)}` : ''}`}
          trailing={<AmountText text={f.money(p.amount, p.currency)} />}
          divider={index < data.payments.length - 1}
        />
      ))}
    </Rows>
  );
}

function AmountText({ text }: { text: string }) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  return <Text style={[styles.amount, fonts.bodyStrong, { color: theme.colors.textPrimary }]}>{text}</Text>;
}

function ExpiringRows({ data }: { data: Payload<'expiringPackages'> }) {
  const t = useT();
  const f = useBoardFormat();
  if (data.packages.length === 0) return <EmptyState title={t('dashboard.empty.expiring', { days: data.withinDays })} />;
  return (
    <Rows>
      {data.packages.map((p, index) => (
        <ListRow
          key={p.memberPackageId}
          title={p.memberName}
          subtitle={`${p.packageName} - ${t('dashboard.table.ends')} ${f.day(p.endDate)}`}
          trailing={<Badge label={p.remainingUnits === null ? t('dashboard.table.unlimited') : f.number(p.remainingUnits)} />}
          divider={index < data.packages.length - 1}
        />
      ))}
    </Rows>
  );
}

function TrainerRows({ data }: { data: Payload<'trainerPerformance'> }) {
  const t = useT();
  const f = useBoardFormat();
  if (data.trainers.length === 0) return <EmptyState title={t('dashboard.empty.trainers')} />;
  return (
    <Rows>
      {data.trainers.map((row, index) => (
        <ListRow
          key={row.trainerProfileId}
          title={row.trainerName}
          subtitle={`${t('dashboard.table.sessions')} ${f.number(row.sessions)} - ${t('dashboard.table.noShows')} ${f.number(row.noShows)}`}
          trailing={<Badge label={f.percent(row.occupancy)} />}
          divider={index < data.trainers.length - 1}
        />
      ))}
    </Rows>
  );
}

function BranchRows({ data }: { data: Payload<'branches'> }) {
  const t = useT();
  const f = useBoardFormat();
  if (data.branches.length === 0) return <EmptyState title={t('screens.dashboard.empty.title')} description={t('screens.dashboard.empty.description')} />;
  return (
    <Rows>
      {data.branches.map((b, index) => (
        <ListRow
          key={b.id}
          title={b.name}
          subtitle={
            b.summary
              ? t('dashboard.branches.summary', { sessions: f.number(b.summary.sessions), occupancy: f.percent(b.summary.occupancy), revenue: f.money(b.summary.revenue, data.currency) })
              : (b.address ?? t('screens.dashboard.noAddress'))
          }
          divider={index < data.branches.length - 1}
        />
      ))}
    </Rows>
  );
}

function LowStockRows({ data }: { data: Payload<'lowStock'> }) {
  const t = useT();
  if (data.items.length === 0) return <EmptyState title={t('retail.lowStock.empty')} />;
  return (
    <Rows>
      {data.items.map((i, index) => (
        <ListRow
          key={`${i.productId}-${i.branchId}`}
          title={i.productName}
          subtitle={t('dashboard.lowStock.detail', { branch: i.branchName, quantity: i.quantity, threshold: i.lowStockThreshold })}
          divider={index < data.items.length - 1}
        />
      ))}
    </Rows>
  );
}

function EventRows({ data }: { data: Payload<'upcomingEvents'> }) {
  const t = useT();
  const f = useBoardFormat();
  if (data.events.length === 0) return <EmptyState title={t('dashboard.empty.events')} />;
  return (
    <Rows>
      {data.events.map((e, index) => {
        const full = e.seatsTaken >= e.capacity;
        return (
          <ListRow
            key={e.id}
            title={e.title}
            subtitle={e.startsAt ? f.dayTime(e.startsAt) : t('dashboard.table.none')}
            trailing={<Badge tone={full ? 'warn' : 'muted'} label={full ? t('dashboard.table.full') : `${f.number(e.seatsTaken)}/${f.number(e.capacity)}`} />}
            divider={index < data.events.length - 1}
          />
        );
      })}
    </Rows>
  );
}

function RevenueChart({ data }: { data: Payload<'revenueTrend'> }) {
  const t = useT();
  const f = useBoardFormat();
  const total = f.money(data.total, data.currency);
  return (
    <View style={styles.chart}>
      <Kpi value={total} hint={t('dashboard.chart.total')} />
      <TrendChart
        accessibilityLabel={t('dashboard.chart.revenueLabel', { total })}
        formatTick={(v) => f.compactMoney(v, data.currency)}
        points={data.points.map((p) => ({ label: f.dateKey(p.date), value: Number(p.amount) }))}
      />
    </View>
  );
}

function OccupancyChart({ data }: { data: Payload<'occupancyTrend'> }) {
  const t = useT();
  const f = useBoardFormat();
  const booked = data.points.reduce((a, p) => a + p.booked, 0);
  const capacity = data.points.reduce((a, p) => a + p.capacity, 0);
  const average = f.percent(capacity > 0 ? booked / capacity : 0);
  return (
    <View style={styles.chart}>
      <Kpi value={average} hint={t('dashboard.chart.average')} />
      <TrendChart max={1} accessibilityLabel={t('dashboard.chart.occupancyLabel', { average })} formatTick={(v) => f.percent(v)} points={data.points.map((p) => ({ label: f.dateKey(p.date), value: p.rate }))} />
    </View>
  );
}

function GrowthChart({ data }: { data: Payload<'memberGrowthChart'> }) {
  const t = useT();
  const f = useBoardFormat();
  const total = f.number(data.points.reduce((a, p) => a + p.joined, 0));
  return (
    <View style={styles.chart}>
      <Kpi value={total} hint={t('dashboard.chart.joinedTotal', { months: data.points.length })} />
      <TrendChart
        accessibilityLabel={t('dashboard.chart.growthLabel', { total })}
        formatTick={(v) => f.number(Math.round(v))}
        points={data.points.map((p) => ({ label: f.monthKey(p.month), value: p.joined }))}
      />
    </View>
  );
}

function QuickActions() {
  const t = useT();
  const router = useRouter();
  const { activeMembership } = useSession();
  const actions = visibleMobileQuickActions(activeMembership?.permissions ?? [], activeMembership?.isOwner ?? false);
  if (actions.length === 0) return <Muted>{t('dashboard.empty.quickActions')}</Muted>;
  return (
    <View style={styles.actions}>
      {actions.map((action) => (
        <Button key={action.key} compact variant="soft" label={t(action.labelKey)} onPress={() => router.push(action.route as never)} />
      ))}
    </View>
  );
}

function Payload({ item, data }: { item: DashboardLayoutItem; data: DashboardWidgetPayload }) {
  switch (data.kind) {
    case 'revenue':
    case 'activeMembers':
    case 'newMembers':
    case 'newLeads':
    case 'memberGrowth':
    case 'occupancy':
    case 'todaySessions':
    case 'renewalRate':
      return <KpiBody data={data} />;
    case 'churnRisk':
      return <ChurnBody data={data} />;
    case 'revenueTrend':
      return <RevenueChart data={data} />;
    case 'occupancyTrend':
      return <OccupancyChart data={data} />;
    case 'memberGrowthChart':
      return <GrowthChart data={data} />;
    case 'sessions':
      if (item.widget === 'weekCalendar') return <WeekDays data={data} />;
      return <SessionRows data={data} withDay={item.widget === 'upcomingSessions'} emptyKey={item.widget === 'upcomingSessions' ? 'dashboard.empty.upcoming' : 'screens.dashboard.today.empty'} />;
    case 'recentPayments':
      return <PaymentRows data={data} />;
    case 'expiringPackages':
      return <ExpiringRows data={data} />;
    case 'trainerPerformance':
      return <TrainerRows data={data} />;
    case 'branches':
      return <BranchRows data={data} />;
    case 'lowStock':
      return <LowStockRows data={data} />;
    case 'upcomingEvents':
      return <EventRows data={data} />;
    case 'none':
    default:
      return null;
  }
}

/** The body of one card: loading, error, forbidden or its content. Forbidden and failed cards show a small muted message. */
export function WidgetBody({ item, state }: { item: DashboardLayoutItem; state: WidgetDataState }) {
  const t = useT();
  if (item.widget === 'quickActions') return <QuickActions />;
  if (state.status === 'loading') {
    return (
      <View style={styles.loading}>
        <Skeleton height={spacing[6]} width="60%" />
        <Skeleton height={spacing[4]} width="80%" />
      </View>
    );
  }
  if (state.status === 'forbidden') return <Muted>{t('dashboard.state.forbidden')}</Muted>;
  if (state.status === 'error') return <Muted>{t('dashboard.state.error')}</Muted>;
  return <Payload item={item} data={state.data} />;
}

const styles = StyleSheet.create({
  muted: { fontSize: typography.size.xs },
  kpi: { gap: spacing[1] },
  kpiValue: { fontSize: typography.size.xl, fontVariant: ['tabular-nums'] },
  kpiLine: { fontSize: typography.size.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] },
  amount: { fontSize: typography.size.sm, fontVariant: ['tabular-nums'] },
  chart: { gap: spacing[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  loading: { gap: spacing[2] },
  week: { gap: 0 },
  weekDay: { paddingVertical: spacing[2], gap: spacing[1] / 2, borderBottomWidth: borderWidth },
  weekHead: { fontSize: typography.size.sm },
  weekSession: { fontSize: typography.size.xs, fontVariant: ['tabular-nums'] },
});
