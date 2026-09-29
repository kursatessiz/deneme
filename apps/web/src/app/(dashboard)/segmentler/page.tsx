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

function SegmentList() {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const t = useT();
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
            <Link href="/segmentler/yeni" className="text-xs font-medium px-3 py-1.5" style={{ background: 'var(--gradient-brand)', color: 'var(--color-on-primary)', borderRadius: 'var(--radius-button)' }}>
              {t('segments.new')}
            </Link>
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
        <div className="overflow-x-auto" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <table className="w-full text-sm" aria-label={t('segments.title')}>
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <th className="px-4 py-2 font-medium">{t('segments.col.name')}</th>
                <th className="px-4 py-2 font-medium">{t('segments.col.kind')}</th>
                <th className="px-4 py-2 font-medium">{t('segments.col.count')}</th>
                <th className="px-4 py-2 font-medium">{t('segments.col.refreshedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-4 py-2.5">
                    <Link href={`/segmentler/${encodeURIComponent(s.id)}`} className="font-medium hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge>{t(`segments.kind.${s.kind}`)}</Badge>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {fmt.number(s.cachedCount)}
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {fmt.dateTime(s.refreshedAt)}
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
    <PageGuard required={['segments.view']}>
      <SegmentList />
    </PageGuard>
  );
}
