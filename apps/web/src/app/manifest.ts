import type { MetadataRoute } from 'next';
import { PERFECT_UI_TOKENS } from '@platform/shared';
import { PLATFORM_BRAND } from '@/lib/seo/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PLATFORM_BRAND.name,
    short_name: PLATFORM_BRAND.name,
    start_url: '/',
    display: 'standalone',
    background_color: PERFECT_UI_TOKENS.colors.light.bg,
    theme_color: PLATFORM_BRAND.primary,
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
