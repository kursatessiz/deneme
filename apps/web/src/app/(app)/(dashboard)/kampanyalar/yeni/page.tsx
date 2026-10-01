'use client';

import { PageGuard } from '@/components/common/PageGuard';
import { CampaignEditor } from '@/components/growth/CampaignEditor';

export default function Page() {
  return (
    <PageGuard required={['campaigns.manage']}>
      <CampaignEditor />
    </PageGuard>
  );
}
