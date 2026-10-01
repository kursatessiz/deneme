'use client';

import { PageGuard } from '@/components/common/PageGuard';
import { SegmentEditor } from '@/components/growth/SegmentEditor';

export default function Page() {
  return (
    <PageGuard required={['segments.manage']}>
      <SegmentEditor />
    </PageGuard>
  );
}
