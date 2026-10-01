'use client';

import Link from 'next/link';
import type { SegmentDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { Badge } from '@/components/common/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { hasAnyPermission } from '@/lib/nav';
import { useBff } from '@/lib/session/use-bff';
import { PageHeader, useDateFormat } from '@/components/growth/ui';
import { useAreaHref } from '@/components/session/AreaBase';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui';
import { LinkButton } from '@/components/ui/LinkButton';

function SegmentList() {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const t = useT();
  const areaHref = useAreaHref();
  const fmt = useDateFormat();
  const { data, loading, error } = useBff<{ items: SegmentDTO[] }>(activeStudioId ? `studios/${activeStudioId}/segments` : null, activeStudioId);
  const canManage = hasAnyPermission(['segments.manage'], permissions, isOwner);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('segments.title')}
        subtitle={t('segments.subtitle')}
        actions={
          canManage ? (
            <LinkButton size="sm" href={areaHref('/segmentler/yeni')}>
              {t('segments.new')}
            </LinkButton>
          ) : undefined
        }
      />
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState
          title={t('segments.empty')}
          description={t('segments.emptyHint')}
          action={{ labelKey: 'segments.new', href: '/segmentler/yeni', permissions: ['segments.manage'] }}
        />
      )}
      {!loading && !error && data && data.items.length > 0 && (
        <div className="overflow-x-auto pui-card">
          <Table aria-label={t('segments.title')}>
            <Thead>
              <Tr>
                <Th>{t('segments.col.name')}</Th>
                <Th>{t('segments.col.kind')}</Th>
                <Th>{t('segments.col.count')}</Th>
                <Th>{t('segments.col.refreshedAt')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {data.items.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <Link href={areaHref(`/segmentler/${encodeURIComponent(s.id)}`)} className="pui-link pui-surface ui-strong">
                      {s.name}
                    </Link>
                  </Td>
                  <Td>
                    <Badge>{t(`segments.kind.${s.kind}`)}</Badge>
                  </Td>
                  <Td className="ui-text-muted">
                    {fmt.number(s.cachedCount)}
                  </Td>
                  <Td className="ui-caption">
                    {fmt.dateTime(s.refreshedAt)}
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
    <PageGuard required={['segments.view']}>
      <SegmentList />
    </PageGuard>
  );
}
