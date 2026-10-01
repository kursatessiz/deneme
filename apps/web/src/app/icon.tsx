import { ImageResponse } from 'next/og';
import { PLATFORM_BRAND, monogram } from '@/lib/seo/brand';
import { loadOgFonts } from '@/lib/og/fonts';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/** Favicon: the product monogram on the brand primary token colour (docs/SEO.md). */
export default async function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: PLATFORM_BRAND.primary, color: PLATFORM_BRAND.onPrimary, fontSize: 22, fontWeight: 700, borderRadius: 6 }}>
        {monogram(PLATFORM_BRAND.name)}
      </div>
    ),
    { ...size, fonts: await loadOgFonts() },
  );
}
