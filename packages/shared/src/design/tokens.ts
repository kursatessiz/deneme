import { z } from 'zod';

/**
 * Design tokens shared by web and mobile. Apps must read colors, spacing,
 * radii and type from here instead of hardcoding values.
 *
 * Skeleton: final values follow the reference screens in docs/design-refs/.
 */

// Warm neutral base. Deliberately not the default Tailwind/shadcn slate and
// no purple: avoid the generic "AI dashboard" look.
export const palette = {
  ink: {
    950: '#14120f',
    900: '#1f1c18',
    800: '#2e2a25',
    700: '#45403a',
    500: '#78716a',
    300: '#b8b1a8',
    200: '#d9d3cb',
    100: '#eeeae4',
    50: '#f8f6f2',
  },
  white: '#ffffff',
  success: '#2f7d4f',
  warning: '#b7791f',
  danger: '#b42318',
  info: '#2b6cb0',
} as const;

export const semanticColors = {
  light: {
    background: palette.ink[50],
    surface: palette.white,
    surfaceMuted: palette.ink[100],
    border: palette.ink[200],
    textPrimary: palette.ink[950],
    textSecondary: palette.ink[700],
    textMuted: palette.ink[500],
  },
  dark: {
    background: palette.ink[950],
    surface: palette.ink[900],
    surfaceMuted: palette.ink[800],
    border: palette.ink[700],
    textPrimary: palette.ink[50],
    textSecondary: palette.ink[200],
    textMuted: palette.ink[300],
  },
} as const;

export const spacing = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

export const radii = { sm: 6, md: 10, lg: 16, xl: 24, full: 9999 } as const;

export const typography = {
  fontFamily: {
    sans: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28, '3xl': 36 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  lineHeight: { tight: 1.2, normal: 1.5 },
} as const;

/**
 * The only places a gradient may be rendered. Components outside these
 * slots use flat colors.
 */
export const GRADIENT_SLOTS = ['appHeaderBand', 'memberCard', 'packageCard', 'primaryButton'] as const;
export type GradientSlot = (typeof GRADIENT_SLOTS)[number];

export interface GradientPreset {
  key: string;
  label: string;
  angle: number;
  stops: readonly [string, string, ...string[]];
}

/** Tenants pick one of these; custom gradients are not allowed. */
export const GRADIENT_PRESETS = [
  { key: 'clay', label: 'Kil', angle: 135, stops: ['#c2410c', '#e8a87c'] },
  { key: 'sage', label: 'Adaçayı', angle: 135, stops: ['#3f6b52', '#9cbfa7'] },
  { key: 'ocean', label: 'Okyanus', angle: 135, stops: ['#1d4e89', '#6fa8dc'] },
  { key: 'sand', label: 'Kum', angle: 135, stops: ['#8a6a3f', '#e3c9a0'] },
  { key: 'graphite', label: 'Grafit', angle: 135, stops: ['#1f1c18', '#5a534b'] },
] as const satisfies readonly GradientPreset[];

export type GradientPresetKey = (typeof GRADIENT_PRESETS)[number]['key'];

const presetKeys = GRADIENT_PRESETS.map((p) => p.key) as [GradientPresetKey, ...GradientPresetKey[]];

/** Everything a tenant may customise: logo, primary color, gradient preset. */
export const TenantThemeSchema = z.object({
  logoUrl: z.string().url().nullable(),
  themePrimary: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Renk #RRGGBB formatında olmalı'),
  gradientPresetKey: z.enum(presetKeys),
});
export type TenantTheme = z.infer<typeof TenantThemeSchema>;

export const DEFAULT_TENANT_THEME: TenantTheme = {
  logoUrl: null,
  themePrimary: '#3f6b52',
  gradientPresetKey: 'sage',
};

export function getGradientPreset(key: GradientPresetKey): GradientPreset {
  const preset = GRADIENT_PRESETS.find((p) => p.key === key);
  if (!preset) throw new Error(`Unknown gradient preset: ${key}`);
  return preset;
}

/** CSS value for web. Mobile passes preset.stops to its gradient component. */
export function gradientCss(key: GradientPresetKey): string {
  const { angle, stops } = getGradientPreset(key);
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}

/** WCAG relative luminance contrast ratio between two #RRGGBB colors. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text color for content on top of a tenant's primary color. */
export function onColor(background: string): string {
  return contrastRatio(background, palette.white) >= 4.5 ? palette.white : palette.ink[950];
}
