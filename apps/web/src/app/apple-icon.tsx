import { ImageResponse } from 'next/og';
import { PLATFORM_BRAND, monogram } from '@/lib/seo/brand';
import { loadOgFonts } from '@/lib/og/fonts';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** Apple touch icon: the same monogram, full bleed (the OS rounds the corners). */
export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: PLATFORM_BRAND.primary, color: PLATFORM_BRAND.onPrimary, fontSize: 120, fontWeight: 700 }}>
        {monogram(PLATFORM_BRAND.name)}
      </div>
    ),
    { ...size, fonts: await loadOgFonts() },
  );
}
