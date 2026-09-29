'use client';

import { useParams } from 'next/navigation';
import { PageGuard } from '@/components/common/PageGuard';
import { JourneyEditor } from '@/components/growth/JourneyEditor';

export default function Page() {
  const { journeyId } = useParams<{ journeyId: string }>();
  return (
    <PageGuard required={['journeys.view']}>
      <JourneyEditor journeyId={journeyId} />
    </PageGuard>
  );
}
