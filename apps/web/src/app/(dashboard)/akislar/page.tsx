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
import { PageHeader, inputStyle } from '@/components/growth/ui';
import { useAreaHref } from '@/components/session/AreaBase';

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
              <Link href={areaHref('/akislar/sablonlar')} className="text-xs font-medium px-3 py-1.5" style={{ ...inputStyle, borderRadius: 'var(--radius-button)' }}>
                {t('journeys.fromTemplate')}
              </Link>
              <Link href={areaHref('/akislar/yeni')} className="text-xs font-medium px-3 py-1.5" style={{ background: 'var(--gradient-brand)', color: 'var(--color-on-primary)', borderRadius: 'var(--radius-button)' }}>
                {t('journeys.new')}
              </Link>
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
        <div className="overflow-x-auto" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <table className="w-full text-sm" aria-label={t('journeys.title')}>
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <th className="px-4 py-2 font-medium">{t('journeys.col.name')}</th>
                <th className="px-4 py-2 font-medium">{t('journeys.col.trigger')}</th>
                <th className="px-4 py-2 font-medium">{t('journeys.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((j) => (
                <tr key={j.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-4 py-2.5">
                    <Link href={areaHref(`/akislar/${encodeURIComponent(j.id)}`)} className="font-medium hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                      {j.name}
                    </Link>
                    {j.legacyRuleType && (
                      <span className="ml-2">
                        <Badge>{t('journeys.legacyBadge')}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {triggerLabel(j, t)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={j.status === 'ACTIVE' ? 'success' : 'neutral'}>{t(`journeys.status.${j.status}`)}</Badge>
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
    <PageGuard required={['journeys.view']}>
      <JourneyList />
    </PageGuard>
  );
}
