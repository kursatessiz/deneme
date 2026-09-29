'use client';

import { ContentCalendar } from '@/components/marketing/ContentCalendar';
import { PlatformPageGuard } from '@/components/marketing/PlatformSession';

/** Content calendar (M2c); read with platform.marketing.view, change with platform.marketing.manage (enforced by the API). */
export default function Page() {
  return (
    <PlatformPageGuard required={['platform.marketing.view', 'platform.marketing.manage']}>
      <ContentCalendar />
    </PlatformPageGuard>
  );
}
