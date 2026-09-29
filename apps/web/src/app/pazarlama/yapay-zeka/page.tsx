'use client';

import { AiStudio } from '@/components/marketing/studio/AiStudio';
import { PlatformPageGuard } from '@/components/marketing/PlatformSession';

/** AI studio (M2b, M2d): brief to drafts, segment suggestions and cited research notes; docs/PAZARLAMA_MODULU.md 4. */
export default function Page() {
  return (
    <PlatformPageGuard required={['platform.ai.use']}>
      <AiStudio />
    </PlatformPageGuard>
  );
}
