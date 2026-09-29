'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { JourneyDTO, JourneyTemplateDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { bffFetch } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { Muted, Notice, PageHeader, errorMessage } from '@/components/growth/ui';
import { useAreaHref } from '@/components/session/AreaBase';

function TemplateGallery() {
  const { activeStudioId } = useDashboardSession();
  const t = useT();
  const areaHref = useAreaHref();
  const router = useRouter();
  const { data, loading, error } = useBff<{ items: JourneyTemplateDTO[] }>(activeStudioId ? `studios/${activeStudioId}/journeys/templates` : null, activeStudioId);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function createFrom(key: string) {
    setBusy(key);
    setNotice(null);
    try {
      const created = await bffFetch<JourneyDTO>(`studios/${activeStudioId}/journeys/from-template`, { method: 'POST', studioId: activeStudioId, body: { templateKey: key } });
      router.push(areaHref(`/akislar/${created.id}`));
    } catch (err) {
      setNotice(errorMessage(err, t('common.error.generic')));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('journeys.templatesTitle')} subtitle={t('journeys.templatesSubtitle')} />
      {notice && <Notice tone="error">{notice}</Notice>}
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-label={t('journeys.templatesTitle')}>
          {data.items.map((tpl) => {
            const trigger = tpl.definition.trigger;
            return (
              <li
                key={tpl.key}
                className="p-4 flex flex-col justify-between gap-3"
                style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
              >
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {t(`journeys.template.${tpl.key}.name`)}
                  </h3>
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {t(`journeys.template.${tpl.key}.description`)}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone="info">{trigger.kind === 'event' ? t(`journeys.event.${trigger.event}`) : t('journeys.trigger.kind.segment_entered')}</Badge>
                    {Object.values(tpl.definition.steps).map((s, i) => (
                      <Badge key={i}>{t(`journeys.step.${s.type}`)}</Badge>
                    ))}
                  </div>
                  {tpl.legacyRuleType && <Muted>{t('journeys.legacyBadge')}</Muted>}
                </div>
                <PermissionButton required={['journeys.manage']} variant="primary" disabled={busy !== null} onClick={() => createFrom(tpl.key)}>
                  {t('journeys.useTemplate')}
                </PermissionButton>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['journeys.view']}>
      <TemplateGallery />
    </PageGuard>
  );
}
