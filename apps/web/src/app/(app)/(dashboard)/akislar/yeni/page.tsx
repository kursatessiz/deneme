'use client';

import { PageGuard } from '@/components/common/PageGuard';
import { JourneyEditor } from '@/components/growth/JourneyEditor';

export default function Page() {
  return (
    <PageGuard required={['journeys.manage']}>
      <JourneyEditor />
    </PageGuard>
  );
}
