'use client';

import { PageGuard } from '@/components/common/PageGuard';
import { SiteEditor } from '@/components/sites/SiteEditor';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';

/** The platform site and landing pages: the same editor as /admin/web-sitesi, on the platform tenant. */
export default function Page() {
  const { activeStudioId } = useDashboardSession();
  return (
    <PageGuard required={['site.manage']}>
      <SiteEditor studioId={activeStudioId} variant="platform" />
    </PageGuard>
  );
}
