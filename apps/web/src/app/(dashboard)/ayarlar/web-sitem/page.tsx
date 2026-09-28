'use client';

import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { SettingsHeader } from '@/components/settings/ui';
import { SiteEditor } from '@/components/sites/SiteEditor';

/** Tenant "Web sitem": the studio's own public site, built with the same page engine as the platform's site (docs/SAYFA_MOTORU.md). */
export default function WebSitemPage() {
  const { activeStudioId } = useDashboardSession();
  return (
    <PageGuard required={['site.view', 'site.manage']}>
      <div className="space-y-6">
        <SettingsHeader title="Web sitem" description="İşletmenizin genel web sitesi: sayfalar, bloklar, alan adı ve yayın" />
        <SiteEditor studioId={activeStudioId} variant="tenant" />
      </div>
    </PageGuard>
  );
}
