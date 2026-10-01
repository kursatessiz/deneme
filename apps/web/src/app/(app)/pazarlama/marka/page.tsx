'use client';

import { BrandKitEditor } from '@/components/marketing/BrandKitEditor';
import { PlatformPageGuard } from '@/components/marketing/PlatformSession';

/** Brand kit and product facts (M2a); read with platform.marketing.view, edit with platform.brand.manage (enforced by the API). */
export default function Page() {
  return (
    <PlatformPageGuard required={['platform.brand.manage', 'platform.marketing.view']}>
      <BrandKitEditor />
    </PlatformPageGuard>
  );
}
