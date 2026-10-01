'use client';

import { MarketingDashboard } from '@/components/marketing/dashboard/MarketingDashboard';
import { PlatformPageGuard } from '@/components/marketing/PlatformSession';

/** Marketing dashboard (M3a, docs/PAZARLAMA_MODULU.md 3.3); the API enforces platform.marketing.view. */
export default function Page() {
  return (
    <PlatformPageGuard required={['platform.marketing.view']}>
      <MarketingDashboard />
    </PlatformPageGuard>
  );
}
