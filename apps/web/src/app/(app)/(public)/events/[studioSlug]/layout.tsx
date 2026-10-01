import { STUDIO_SLUG_PATTERN } from '@platform/shared';
import { PublicTracking } from '@/components/consent/PublicTracking';

/** Consent banner and visitor tracking for a studio's public event pages, as on its booking pages. */
export default async function PublicEventsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ studioSlug: string }>;
}) {
  const { studioSlug } = await params;
  return (
    <>
      {children}
      {STUDIO_SLUG_PATTERN.test(studioSlug) ? <PublicTracking studioSlug={studioSlug} /> : null}
    </>
  );
}
