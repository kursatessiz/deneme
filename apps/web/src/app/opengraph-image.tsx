import { PRODUCT_NAME } from '@platform/shared';
import { getT } from '@/lib/i18n/getT';
import { fetchPlatformBrand } from '@/lib/sites/api';
import { fetchLogoDataUri } from '@/lib/og/logo';
import { OG_SIZE, renderOgCard } from '@/lib/og/card';
import { PLATFORM_BRAND } from '@/lib/seo/brand';

export const size = OG_SIZE;
export const contentType = 'image/png';

/** Open Graph image of the product landing page and the default for pages that set none (docs/SEO.md). */
export default async function Image() {
  const { t } = await getT();
  const brand = await fetchPlatformBrand();
  return renderOgCard({
    title: t('landing.hero.title'),
    description: t('landing.meta.description'),
    name: PRODUCT_NAME,
    primary: brand.themePrimary ?? PLATFORM_BRAND.primary,
    logoDataUri: await fetchLogoDataUri(brand.logoUrl),
  });
}
