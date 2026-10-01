import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/getT';
import { STUDIO_SLUG_PATTERN } from '@platform/shared';
import { PublicTracking } from '@/components/consent/PublicTracking';

/** Embed pages are never indexed (docs/SEO.md); the title is the neutral booking title. */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('booking.defaultTitle'), robots: { index: false, follow: false } };
}

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
