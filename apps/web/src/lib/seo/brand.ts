import { DEFAULT_TENANT_THEME, PRODUCT_NAME, onColor } from '@platform/shared';

/** The platform's own default brand for generated assets (icons, manifest, Open Graph fallback). Tokens only. */
export const PLATFORM_BRAND = {
  name: PRODUCT_NAME,
  primary: DEFAULT_TENANT_THEME.themePrimary,
  onPrimary: onColor(DEFAULT_TENANT_THEME.themePrimary),
} as const;

/** First letter of the product name, upper case: the monogram drawn in icons. */
export function monogram(name: string): string {
  return (Array.from(name.trim())[0] ?? '').toLocaleUpperCase();
}
