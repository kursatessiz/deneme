import { deriveBrandPalette } from './brand';
import { PERFECT_UI_TOKENS, THEME_FAMILIES } from './themes';
import type { ColorMode } from './themes';

/**
 * Plain, non-hook color set for surfaces that live outside the React theme
 * context: the Android home-screen widget renders in a headless JS task with
 * no ThemeProvider, so it reads this palette instead of `useTheme()`. The
 * values are the very tokens the app uses (the default `perfect` family and
 * the tenant's corrected brand palette), never a second copy.
 */
export interface WidgetPalette {
  /** Widget background (`--pui-bg`). */
  background: string;
  /** Primary text. */
  text: string;
  /** Secondary text (the kit's muted text). */
  textMuted: string;
  /** Hairline around the widget. */
  border: string;
  /** Brand color for solid fills. */
  theme: string;
  /** Text on `theme`. */
  onTheme: string;
  /** Brand color as text on `background` (4.5:1). */
  themeText: string;
}

/**
 * The palette of one mode. `primary` is the studio's primary color when the
 * widget knows it; it is corrected for contrast exactly like the app does
 * (deriveBrandPalette). Without it, the kit's own brand pair applies.
 */
export function widgetPalette(mode: ColorMode, primary?: string | null): WidgetPalette {
  const family = THEME_FAMILIES.perfect;
  const colors = family.colors[mode];
  const kit = PERFECT_UI_TOKENS.colors[mode].theme;
  const derived = deriveBrandPalette(primary ?? kit, { mode, background: colors.background });
  const usesKit = !primary;
  return {
    background: colors.background,
    text: colors.textPrimary,
    textMuted: colors.textMuted,
    border: colors.border,
    theme: usesKit ? kit : derived.primary,
    onTheme: usesKit ? colors.background : derived.onPrimary,
    themeText: derived.primaryText,
  };
}

/** The default palettes (kit brand color), light and dark. */
export const WIDGET_PALETTE: Readonly<Record<ColorMode, WidgetPalette>> = {
  light: widgetPalette('light'),
  dark: widgetPalette('dark'),
};
