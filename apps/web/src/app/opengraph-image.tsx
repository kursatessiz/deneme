import { PRODUCT_NAME } from '@platform/shared';
import { fetchPlatformBrand } from '@/lib/sites/api';
import { fetchLogoDataUri } from '@/lib/og/logo';
import { OG_SIZE, renderOgCard } from '@/lib/og/card';
import { PLATFORM_BRAND } from '@/lib/seo/brand';

export const size = OG_SIZE;
export const contentType = 'image/png';

/** Default Open Graph image for pages that set none: a card with the product name only (docs/SEO.md). */
export default async function Image() {
  const brand = await fetchPlatformBrand();
  return renderOgCard({
    title: PRODUCT_NAME,
    name: PRODUCT_NAME,
    primary: brand.themePrimary ?? PLATFORM_BRAND.primary,
    logoDataUri: await fetchLogoDataUri(brand.logoUrl),
  });
}
