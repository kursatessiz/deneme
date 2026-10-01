'use client';

import { IntegrationHub } from '@/components/integrations/IntegrationHub';
import { PlatformPageGuard } from '@/components/marketing/PlatformSession';

/** Integrations hub, marketing entry point (doc 5.1); /admin/entegrasyonlar renders the same component. */
export default function Page() {
  return (
    <PlatformPageGuard required={['platform.integrations.manage']}>
      <IntegrationHub entry="marketing" adsSettingsHref="/pazarlama/reklam/ayarlar" />
    </PlatformPageGuard>
  );
}
