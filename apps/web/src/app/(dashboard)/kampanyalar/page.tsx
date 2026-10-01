'use client';

import Link from 'next/link';
import type { CampaignDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { Badge } from '@/components/common/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { hasAnyPermission } from '@/lib/nav';
import { useBff } from '@/lib/session/use-bff';
import { PageHeader, useDateFormat } from '@/components/growth/ui';
import { campaignStatusTone } from '@/components/growth/CampaignEditor';
import { useAreaHref } from '@/components/session/AreaBase';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui';
import { LinkButton } from '@/components/ui/LinkButton';

function CampaignList() {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const t = useT();
  const areaHref = useAreaHref();
  const fmt = useDateFormat();
  const { data, loading, error } = useBff<{ items: CampaignDTO[] }>(activeStudioId ? `studios/${activeStudioId}/campaigns` : null, activeStudioId);
  const canManage = hasAnyPermission(['campaigns.manage'], permissions, isOwner);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('campaigns.title')}
        subtitle={t('campaigns.subtitle')}
        actions={
          canManage ? (
            <LinkButton size="sm" href={areaHref('/kampanyalar/yeni')}>
              {t('campaigns.new')}
            </LinkButton>
          ) : undefined
        }
      />
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState
          title={t('campaigns.empty')}
          description={t('campaigns.emptyHint')}
          action={{ labelKey: 'campaigns.new', href: '/kampanyalar/yeni', permissions: ['campaigns.manage'] }}
        />
      )}
      {!loading && !error && data && data.items.length > 0 && (
        <div className="overflow-x-auto pui-card">
          <Table aria-label={t('campaigns.title')}>
            <Thead>
              <Tr>
                <Th>{t('campaigns.col.name')}</Th>
                <Th>{t('campaigns.col.segment')}</Th>
                <Th>{t('campaigns.col.status')}</Th>
                <Th>{t('campaigns.col.sent')}</Th>
                <Th>{t('campaigns.col.scheduledAt')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {data.items.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link href={areaHref(`/kampanyalar/${encodeURIComponent(c.id)}`)} className="pui-link pui-surface ui-strong">
                      {c.name}
                    </Link>
                  </Td>
                  <Td className="ui-text-muted">
                    {c.segmentName ?? ''}
                  </Td>
                  <Td>
                    <Badge tone={campaignStatusTone(c.status)}>{t(`campaigns.status.${c.status}`)}</Badge>
                  </Td>
                  <Td className="ui-text-muted">
                    {`${fmt.number(c.stats.sent)} / ${fmt.number(c.stats.audience)}`}
                  </Td>
                  <Td className="ui-caption">
                    {fmt.dateTime(c.completedAt ?? c.scheduledAt)}
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
    <PageGuard required={['campaigns.view']}>
      <CampaignList />
    </PageGuard>
  );
}
