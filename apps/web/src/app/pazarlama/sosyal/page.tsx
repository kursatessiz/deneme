'use client';

import { PlatformPageGuard } from '@/components/marketing/PlatformSession';
import { SocialPosts } from '@/components/marketing/social/SocialPosts';

/** Organic social posts (M4b): reading needs platform.marketing.view, drafting .manage, scheduling and publishing .send (enforced by the API). */
export default function Page() {
  return (
    <PlatformPageGuard required={['platform.marketing.view']}>
      <SocialPosts />
    </PlatformPageGuard>
  );
}
