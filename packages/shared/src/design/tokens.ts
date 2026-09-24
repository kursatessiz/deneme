import { z } from 'zod';
import {
  COLOR_SCHEME_PREFERENCES,
  DEFAULT_THEME_FAMILY,
  THEME_FAMILIES,
  THEME_FAMILY_KEYS,
  getThemeFamily,
} from './themes';
import type { ColorMode, GradientPreset, ThemeColors, ThemeFamily, ThemeFamilyKey } from './themes';

/**
 * Design tokens shared by web and mobile. Apps must read colors, spacing,
 * radii and type from here instead of hardcoding values.
 *
 * Theme families (fonts, radii, neutrals, gradient sets) live in themes.ts;
 * resolveTheme() combines the tenant's brand with the user's appearance.
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

/** Every preset of every family; tenants pick one, custom gradients are not allowed. */
export const GRADIENT_PRESETS: readonly GradientPreset[] = THEME_FAMILY_KEYS.flatMap((k) => THEME_FAMILIES[k].gradients);

type FamilyGradientKey<K extends ThemeFamilyKey> = (typeof THEME_FAMILIES)[K]['gradients'][number]['key'];
export type GradientPresetKey = { [K in ThemeFamilyKey]: FamilyGradientKey<K> }[ThemeFamilyKey];

const presetKeys = GRADIENT_PRESETS.map((p) => p.key) as [GradientPresetKey, ...GradientPresetKey[]];
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Everything a tenant may customise: logo, theme family, primary color, gradient preset. */
export const TenantThemeSchema = z
  .object({
    logoUrl: z.string().url().nullable(),
    themeFamily: z.enum(THEME_FAMILY_KEYS),
    themePrimary: z.string().regex(HEX, 'Renk #RRGGBB formatında olmalı'),
    gradientPresetKey: z.enum(presetKeys),
  })
  .refine((t) => familyOfGradient(t.gradientPresetKey) === t.themeFamily, {
    path: ['gradientPresetKey'],
    message: 'Gradyan seçilen tema ailesine ait olmalı',
  });
export type TenantTheme = z.infer<typeof TenantThemeSchema>;

export const UpdateTenantThemeSchema = TenantThemeSchema;
export type UpdateTenantThemeInput = TenantTheme;

export const DEFAULT_TENANT_THEME: TenantTheme = {
  logoUrl: null,
  themeFamily: DEFAULT_THEME_FAMILY,
  themePrimary: '#2F6F5E',
  gradientPresetKey: 'atolye-orman',
};

/** A user's own appearance choice; null family follows the tenant. */
export const AppearancePreferenceSchema = z.object({
  themeFamily: z.enum(THEME_FAMILY_KEYS).nullable(),
  colorScheme: z.enum(COLOR_SCHEME_PREFERENCES),
});
export type AppearancePreference = z.infer<typeof AppearancePreferenceSchema>;

export const DEFAULT_APPEARANCE: AppearancePreference = { themeFamily: null, colorScheme: 'SYSTEM' };

export function familyOfGradient(key: string): ThemeFamilyKey | null {
  for (const k of THEME_FAMILY_KEYS) {
    if (THEME_FAMILIES[k].gradients.some((g) => g.key === key)) return k;
  }
  return null;
}

export function getGradientPreset(key: string): GradientPreset {
  const preset = GRADIENT_PRESETS.find((p) => p.key === key);
  if (!preset) throw new Error(`Unknown gradient preset: ${key}`);
  return preset;
}

/** CSS value for web. Mobile passes preset.stops to its gradient component. */
export function gradientCss(key: string): string {
  const { angle, stops } = getGradientPreset(key);
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}

export interface ResolvedTheme {
  family: ThemeFamily;
  mode: ColorMode;
  colors: ThemeColors & { primary: string; onPrimary: string };
  gradient: GradientPreset;
  logoUrl: string | null;
}

/**
 * The theme a screen renders: the user's family (or the tenant's), the
 * user's mode (or the OS mode), and always the tenant's brand colors.
 * Unknown or stale values fall back to defaults instead of throwing, so a
 * removed preset can never break an app.
 */
export function resolveTheme(params: {
  tenant: Partial<TenantTheme> | null | undefined;
  appearance: Partial<AppearancePreference> | null | undefined;
  systemMode: ColorMode | null | undefined;
}): ResolvedTheme {
  const tenant = { ...DEFAULT_TENANT_THEME, ...(params.tenant ?? {}) };
  const appearance = { ...DEFAULT_APPEARANCE, ...(params.appearance ?? {}) };
  const family = getThemeFamily(appearance.themeFamily ?? tenant.themeFamily);
  const mode: ColorMode =
    appearance.colorScheme === 'LIGHT' ? 'light' : appearance.colorScheme === 'DARK' ? 'dark' : (params.systemMode ?? 'light');
  const gradient =
    GRADIENT_PRESETS.find((p) => p.key === tenant.gradientPresetKey) ?? getThemeFamily(tenant.themeFamily).gradients[0];
  const primary = HEX.test(tenant.themePrimary) ? tenant.themePrimary : DEFAULT_TENANT_THEME.themePrimary;
  return {
    family,
    mode,
    colors: { ...family.colors[mode], primary, onPrimary: onColor(primary) },
    gradient,
    logoUrl: tenant.logoUrl ?? null,
  };
}

/** CSS custom properties for web roots (`style` of <html> or a wrapper). */
export function themeCssVariables(theme: ResolvedTheme): Record<string, string> {
  const c = theme.colors;
  return {
    '--color-background': c.background,
    '--color-surface': c.surface,
    '--color-surface-muted': c.surfaceMuted,
    '--color-border': c.border,
    '--color-text-primary': c.textPrimary,
    '--color-text-secondary': c.textSecondary,
    '--color-text-muted': c.textMuted,
    '--color-primary': c.primary,
    '--color-on-primary': c.onPrimary,
    '--gradient-brand': gradientCss(theme.gradient.key),
    '--font-display': theme.family.fonts.display.web,
    '--font-body': theme.family.fonts.body.web,
    '--radius-card': `${theme.family.radii.card}px`,
    '--radius-button': `${theme.family.radii.button}px`,
    '--radius-chip': `${theme.family.radii.chip}px`,
    '--radius-input': `${theme.family.radii.input}px`,
  };
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
