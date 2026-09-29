'use client';

import { useParams } from 'next/navigation';
import { PageGuard } from '@/components/common/PageGuard';
import { SegmentEditor } from '@/components/growth/SegmentEditor';

export default function Page() {
  const { segmentId } = useParams<{ segmentId: string }>();
  return (
    <PageGuard required={['segments.view']}>
      <SegmentEditor segmentId={segmentId} />
    </PageGuard>
  );
}
