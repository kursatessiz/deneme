'use client';

import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { SettingsHeader } from '@/components/settings/ui';
import { SiteEditor } from '@/components/sites/SiteEditor';

/** Tenant "Web sitem": the studio's own public site, built with the same page engine as the platform's site (docs/SAYFA_MOTORU.md). */
export default function WebSitemPage() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  return (
    <PageGuard required={['site.view', 'site.manage']}>
      <div className="space-y-6">
        <SettingsHeader title={t('settings.site.title')} description={t('settings.site.description')} />
        <SiteEditor studioId={activeStudioId} variant="tenant" />
      </div>
    </PageGuard>
  );
}
