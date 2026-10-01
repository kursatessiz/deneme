'use client';

import Link from 'next/link';
import type { JourneyDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { Badge } from '@/components/common/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { hasAnyPermission } from '@/lib/nav';
import { useBff } from '@/lib/session/use-bff';
import { PageHeader } from '@/components/growth/ui';
import { useAreaHref } from '@/components/session/AreaBase';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui';
import { LinkButton } from '@/components/ui/LinkButton';

function triggerLabel(j: JourneyDTO, t: (key: string) => string): string {
  const trigger = j.definition.trigger;
  return trigger.kind === 'event' ? t(`journeys.event.${trigger.event}`) : t('journeys.trigger.kind.segment_entered');
}

function JourneyList() {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const t = useT();
  const areaHref = useAreaHref();
  const { data, loading, error } = useBff<{ items: JourneyDTO[] }>(activeStudioId ? `studios/${activeStudioId}/journeys` : null, activeStudioId);
  const canManage = hasAnyPermission(['journeys.manage'], permissions, isOwner);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('journeys.title')}
        subtitle={t('journeys.subtitle')}
        actions={
          canManage ? (
            <>
              <LinkButton variant="outline" tone="surface" size="sm" href={areaHref('/akislar/sablonlar')}>
                {t('journeys.fromTemplate')}
              </LinkButton>
              <LinkButton size="sm" href={areaHref('/akislar/yeni')}>
                {t('journeys.new')}
              </LinkButton>
            </>
          ) : undefined
        }
      />
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState
          title={t('journeys.empty')}
          description={t('journeys.emptyHint')}
          action={{ labelKey: 'journeys.new', href: '/akislar/yeni', permissions: ['journeys.manage'] }}
        />
      )}
      {!loading && !error && data && data.items.length > 0 && (
        <div className="overflow-x-auto pui-card">
          <Table aria-label={t('journeys.title')}>
            <Thead>
              <Tr>
                <Th>{t('journeys.col.name')}</Th>
                <Th>{t('journeys.col.trigger')}</Th>
                <Th>{t('journeys.col.status')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {data.items.map((j) => (
                <Tr key={j.id}>
                  <Td>
                    <Link href={areaHref(`/akislar/${encodeURIComponent(j.id)}`)} className="pui-link pui-surface ui-strong">
                      {j.name}
                    </Link>
                    {j.legacyRuleType && (
                      <span className="ml-2">
                        <Badge>{t('journeys.legacyBadge')}</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="ui-text-muted">
                    {triggerLabel(j, t)}
                  </Td>
                  <Td>
                    <Badge tone={j.status === 'ACTIVE' ? 'success' : 'neutral'}>{t(`journeys.status.${j.status}`)}</Badge>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['journeys.view']}>
      <JourneyList />
    </PageGuard>
  );
}
