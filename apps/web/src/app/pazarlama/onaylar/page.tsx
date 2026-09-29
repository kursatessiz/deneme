'use client';

import { ApprovalsQueue } from '@/components/marketing/ApprovalsQueue';
import { PlatformPageGuard } from '@/components/marketing/PlatformSession';

/** Approval queue (M3b): reading needs platform.marketing.view; approve and reject are for super admins (enforced by the API). */
export default function Page() {
  return (
    <PlatformPageGuard required={['platform.marketing.view']}>
      <ApprovalsQueue />
    </PlatformPageGuard>
  );
}
