import type { Metadata } from 'next';
import { PRODUCT_NAME, STUDIO_SLUG_PATTERN } from '@platform/shared';
import { PublicTracking } from '@/components/consent/PublicTracking';
import { getT } from '@/lib/i18n/getT';
import { fetchBookingStudio } from '@/lib/sites/api';
import { siteOrigin } from '@/lib/sites/origin';
import { toOgLocale } from '@/lib/seo/og-locale';

/**
 * The booking page is public and indexable: "<studio> | <booking title>", a translated description,
 * the studio logo as Open Graph image and a canonical URL on the platform origin. An unknown studio
 * is not indexed.
 */
export async function generateMetadata({ params }: { params: Promise<{ studioSlug: string }> }): Promise<Metadata> {
  const { studioSlug } = await params;
  const { t, locale } = await getT();
  const studio = STUDIO_SLUG_PATTERN.test(studioSlug) ? await fetchBookingStudio(studioSlug) : null;
  if (!studio) return { title: t('booking.defaultTitle'), robots: { index: false, follow: false } };

  const title = t('seo.booking.title', { studio: studio.name, booking: t('booking.defaultTitle') });
  const description = t('seo.booking.description', { studio: studio.name });
  const url = `${siteOrigin('platform', true)}/booking/${studioSlug}/book`;
  const images = studio.logoUrl ? [{ url: studio.logoUrl, alt: studio.name }] : undefined;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: studio.name || PRODUCT_NAME, locale: toOgLocale(locale), title, description, url, ...(images ? { images } : {}) },
    twitter: { card: images ? 'summary_large_image' : 'summary', title, description, ...(images ? { images: [images[0].url] } : {}) },
  };
}

/** Consent banner and visitor tracking for a studio's public booking pages. */
export default async function PublicStudioLayout({
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
