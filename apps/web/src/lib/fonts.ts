import type { ThemeFamilyKey } from '@platform/shared';

/**
 * Web fonts for the four theme families, self-hosted from @fontsource
 * packages (bundled at build time, no network needed, no runtime Google
 * Fonts request). The @fontsource CSS covers every subset with
 * unicode-range, so Turkish characters (latin-ext) render in the theme
 * font and the browser downloads only the ranges a page uses. The actual
 * `@font-face` imports live in (dashboard)/fonts.css. Keep these family
 * names in sync with `googleFonts` in packages/shared/src/design/themes.ts.
 */
export const FAMILY_FONT_VARIABLES: Record<ThemeFamilyKey, { display: string; body: string }> = {
  noir: { display: "'Schibsted Grotesk', system-ui, sans-serif", body: "'Figtree', system-ui, sans-serif" },
  nefes: { display: "'Fraunces', Georgia, serif", body: "'Nunito Sans', system-ui, sans-serif" },
  saha: { display: "'Archivo', system-ui, sans-serif", body: "'IBM Plex Sans', system-ui, sans-serif" },
  atolye: { display: "'Manrope', system-ui, sans-serif", body: "'Manrope', system-ui, sans-serif" },
};
