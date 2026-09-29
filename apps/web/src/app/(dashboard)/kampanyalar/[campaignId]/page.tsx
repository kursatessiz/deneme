'use client';

import { useParams } from 'next/navigation';
import { PageGuard } from '@/components/common/PageGuard';
import { CampaignEditor } from '@/components/growth/CampaignEditor';

export default function Page() {
  const { campaignId } = useParams<{ campaignId: string }>();
  return (
    <PageGuard required={['campaigns.view']}>
      <CampaignEditor campaignId={campaignId} />
    </PageGuard>
  );
}
