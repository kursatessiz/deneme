import { STUDIO_SLUG_PATTERN } from '@platform/shared';
import { PublicTracking } from '@/components/consent/PublicTracking';

/** Adds the consent banner and visitor tracking (for this studio) to the embed widget. */
export default async function EmbedLayout({
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
