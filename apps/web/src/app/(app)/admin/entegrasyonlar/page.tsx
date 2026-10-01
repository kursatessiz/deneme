'use client';

import { IntegrationHub } from '@/components/integrations/IntegrationHub';

/** Integrations hub, super admin entry point: same component and endpoints as /pazarlama/entegrasyonlar, plus the platform-only cards. */
export default function AdminIntegrationsPage() {
  return <IntegrationHub entry="admin" adsSettingsHref="/pazarlama/reklam/ayarlar" />;
}
