'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EVENT_STATUSES } from '@platform/shared';
import type { EventDTO, EventStatus } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { Badge } from '@/components/common/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { hasAnyPermission } from '@/lib/nav';
import { useBff } from '@/lib/session/use-bff';
import { PageHeader, useDateFormat } from '@/components/growth/ui';
import { Card, FieldGroup, LinkButton, Select, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';

function EventList() {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const t = useT();
  const fmt = useDateFormat();
  const [status, setStatus] = useState<EventStatus | ''>('');
  const path = activeStudioId ? `studios/${activeStudioId}/events${status ? `?status=${status}` : ''}` : null;
  const { data, loading, error, forbidden } = useBff<{ items: EventDTO[] }>(path, activeStudioId);
  const canManage = hasAnyPermission(['events.manage'], permissions, isOwner);

  if (forbidden) return <ErrorState message={t('events.forbidden')} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('events.title')}
        subtitle={t('events.subtitle')}
        actions={
          canManage ? (
            <LinkButton href="/etkinlikler/yeni" size="sm">
              {t('events.new')}
            </LinkButton>
          ) : undefined
        }
      />
      <div className="max-w-xs">
        <FieldGroup label={t('events.filter.status')}>
          <Select id="events-status" value={status} onChange={(e) => setStatus(e.target.value as EventStatus | '')}>
            <option value="">{t('events.filter.all')}</option>
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`events.status.${s}`)}
              </option>
            ))}
          </Select>
        </FieldGroup>
      </div>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState title={t('events.empty')} description={t('events.emptyHint')} action={{ labelKey: 'events.new', href: '/etkinlikler/yeni', permissions: ['events.manage'] }} />
      )}
      {!loading && !error && data && data.items.length > 0 && (
        <Card className="overflow-x-auto">
          <Table aria-label={t('events.title')}>
            <Thead>
              <Tr>
                <Th>{t('events.col.title')}</Th>
                <Th>{t('events.col.date')}</Th>
                <Th>{t('events.col.status')}</Th>
                <Th>{t('events.col.seats')}</Th>
                <Th>{t('events.col.waitlist')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {data.items.map((e) => (
                <Tr key={e.id}>
                  <Td>
                    <Link href={`/etkinlikler/${encodeURIComponent(e.id)}`} className="pui-link pui-surface ui-strong">
                      {e.title}
                    </Link>
                    <p className="ui-caption">{t(`events.kind.${e.kind}`)}</p>
                  </Td>
                  <Td className="ui-small">{e.startsAt ? fmt.dateTime(e.startsAt) : t('events.noDate')}</Td>
                  <Td>
                    <Badge>{t(`events.status.${e.status}`)}</Badge>
                  </Td>
                  <Td>{t('events.seats', { taken: fmt.number(e.seatsTaken), capacity: fmt.number(e.capacity) })}</Td>
                  <Td>{e.waitlistEnabled ? fmt.number(e.waitlistCount) : '-'}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['events.view']}>
      <EventList />
    </PageGuard>
  );
}
