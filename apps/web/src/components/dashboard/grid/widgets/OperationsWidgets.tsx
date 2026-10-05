'use client';

import { MapPin } from 'lucide-react';
import type { DashboardWidgetPayload } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { useWidgetFormat } from './common';

type Payload<K extends DashboardWidgetPayload['kind']> = Extract<DashboardWidgetPayload, { kind: K }>;

export function BranchList({ data }: { data: Payload<'branches'> }) {
  const t = useT();
  const f = useWidgetFormat();
  if (data.branches.length === 0) return <EmptyState title={t('screens.dashboard.empty.title')} description={t('screens.dashboard.empty.description')} className="py-6" />;
  return (
    <ul className="pui-list ui-divide">
      {data.branches.map((b) => (
        <li key={b.id} className="pui-list-item flex items-start gap-3 min-w-0">
          <MapPin className="ui-icon mt-0.5 ui-text-muted" aria-hidden="true" />
          <span className="grid min-w-0">
            <span className="ui-heading truncate" title={b.name}>
              {b.name}
            </span>
            <span className="ui-caption truncate" title={b.address ?? undefined}>
              {b.address ?? t('screens.dashboard.noAddress')}
            </span>
            {b.summary ? (
              <span className="ui-caption truncate">
                {t('dashboard.branches.summary', {
                  sessions: f.number(b.summary.sessions),
                  occupancy: f.percent(b.summary.occupancy),
                  revenue: f.money(b.summary.revenue, data.currency),
                })}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LowStockList({ data }: { data: Payload<'lowStock'> }) {
  const t = useT();
  if (data.items.length === 0) return <EmptyState title={t('retail.lowStock.empty')} className="py-6" />;
  return (
    <ul className="pui-list ui-divide">
      {data.items.map((i) => {
        const text = t('retail.lowStock.row', { product: i.productName, branch: i.branchName, quantity: i.quantity, threshold: i.lowStockThreshold });
        return (
          <li key={`${i.productId}-${i.branchId}`} className="pui-list-item min-w-0">
            <span className="block truncate" title={text}>
              {text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function EventList({ data }: { data: Payload<'upcomingEvents'> }) {
  const t = useT();
  const f = useWidgetFormat();
  if (data.events.length === 0) return <EmptyState title={t('dashboard.empty.events')} className="py-6" />;
  return (
    <ul className="pui-list ui-divide">
      {data.events.map((e) => {
        const full = e.seatsTaken >= e.capacity;
        return (
          <li key={e.id} className="pui-list-item flex items-center gap-3 min-w-0">
            <span className="grid flex-1 min-w-0">
              <span className="truncate" title={e.title}>
                {e.title}
              </span>
              <span className="ui-caption truncate">{e.startsAt ? f.dayTime(e.startsAt) : t('dashboard.table.none')}</span>
            </span>
            <Badge tone={full ? 'warn' : 'muted'}>{full ? t('dashboard.table.full') : `${f.number(e.seatsTaken)}/${f.number(e.capacity)}`}</Badge>
          </li>
        );
      })}
    </ul>
  );
}
