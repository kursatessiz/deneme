import { contrastRatio, onColor } from '@platform/shared';
import type { ResolvedTheme } from '@platform/shared';

/** Semantic tones of the kit (`pui-theme`, `pui-success`, ...) plus the neutral surface. */
export type Tone = 'theme' | 'success' | 'warn' | 'error' | 'muted' | 'surface';

export interface ToneColors {
  /** Fill of a solid element. */
  main: string;
  /** Text and icons on `main`. */
  onMain: string;
  /** Tinted fill of a soft element. */
  soft: string;
  /** Text and icons of soft and outline elements, kept readable on the page background. */
  ink: string;
  /** Line of outline elements. */
  line: string;
}

/** `#rrggbb` with an alpha channel as `#rrggbbaa`. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/** Colors of one tone for the active theme. The tenant primary is the `theme` tone. */
export function toneColors(theme: ResolvedTheme, tone: Tone): ToneColors {
  const c = theme.colors;
  if (tone === 'surface') {
    return { main: c.surfaceMuted, onMain: c.textPrimary, soft: c.surfaceMuted, ink: c.textPrimary, line: c.border };
  }
  const main = tone === 'theme' ? c.primary : theme.roles[tone];
  const onMain = tone === 'theme' ? c.onPrimary : onColor(main);
  // A pale tone would vanish as text on the page; fall back to the text color.
  const ink = contrastRatio(main, c.background) >= 3 ? main : c.textPrimary;
  return { main, onMain, soft: withAlpha(main, 0.12), ink, line: main };
}
