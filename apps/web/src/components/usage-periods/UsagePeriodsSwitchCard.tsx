'use client';

import { useEffect, useState } from 'react';
import type { UsagePeriodsSettingDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useAreaHref } from '@/components/session/AreaBase';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { InlineMessage, Section, Toggle } from '@/components/settings/ui';
import { LinkButton } from '@/components/ui/LinkButton';

/**
 * The studio switch of usage periods (docs/KULLANIM_DONEMLERI.md). Everyone who can view the settings sees it;
 * only the owner can change it (the API answers 403 to anyone else), so the others get it disabled with a note.
 */
export function UsagePeriodsSwitchCard() {
  const t = useT();
  const areaHref = useAreaHref();
  const { activeStudioId, isOwner } = useDashboardSession();
  const path = `studios/${activeStudioId}/usage-periods`;
  const { data, loading, error } = useBff<UsagePeriodsSettingDTO>(path, activeStudioId);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setEnabled(data.enabled);
  }, [data]);

  async function change(next: boolean) {
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    const previous = enabled;
    setEnabled(next);
    try {
      const updated = await bffFetch<UsagePeriodsSettingDTO>(path, { method: 'PUT', body: { enabled: next }, studioId: activeStudioId });
      setEnabled(updated.enabled);
      setSaved(true);
    } catch (err) {
      setEnabled(previous);
      setSaveError(err instanceof BffError ? err.message : t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  return (
    <Section title={t('usagePeriods.settings.title')} description={t('usagePeriods.settings.description')}>
      <Toggle label={t('usagePeriods.settings.switchLabel')} checked={enabled} disabled={!isOwner || saving} onChange={(v) => void change(v)} />
      {!isOwner && <InlineMessage text={t('usagePeriods.settings.ownerOnly')} />}
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text={t('usagePeriods.settings.saved')} tone="success" />}
      <div>
        <LinkButton href={areaHref('/packages')} variant="outline" tone="surface" size="sm">
          {t('usagePeriods.settings.packagesLink')}
        </LinkButton>
      </div>
    </Section>
  );
}
