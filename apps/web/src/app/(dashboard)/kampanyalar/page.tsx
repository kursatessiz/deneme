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

function CampaignList() {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const t = useT();
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
            <Link href="/kampanyalar/yeni" className="text-xs font-medium px-3 py-1.5" style={{ background: 'var(--gradient-brand)', color: 'var(--color-on-primary)', borderRadius: 'var(--radius-button)' }}>
              {t('campaigns.new')}
            </Link>
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
        <div className="overflow-x-auto" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <table className="w-full text-sm" aria-label={t('campaigns.title')}>
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <th className="px-4 py-2 font-medium">{t('campaigns.col.name')}</th>
                <th className="px-4 py-2 font-medium">{t('campaigns.col.segment')}</th>
                <th className="px-4 py-2 font-medium">{t('campaigns.col.status')}</th>
                <th className="px-4 py-2 font-medium">{t('campaigns.col.sent')}</th>
                <th className="px-4 py-2 font-medium">{t('campaigns.col.scheduledAt')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-4 py-2.5">
                    <Link href={`/kampanyalar/${encodeURIComponent(c.id)}`} className="font-medium hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {c.segmentName ?? ''}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={campaignStatusTone(c.status)}>{t(`campaigns.status.${c.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {`${fmt.number(c.stats.sent)} / ${fmt.number(c.stats.audience)}`}
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {fmt.dateTime(c.completedAt ?? c.scheduledAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
