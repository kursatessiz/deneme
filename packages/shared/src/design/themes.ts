/**
 * Design language. The product renders one visual language, Perfect UI
 * (https://perfectui.dev, MIT). The four former theme families (noir, nefes,
 * saha, atolye) were retired in T1; their keys may still be stored on studios
 * and users, so every lookup is tolerant and maps them to the single family.
 *
 * The tenant's brand (primary color, logo) always stays the tenant's; the
 * user only chooses light, dark or system.
 */

export const THEME_FAMILY_KEYS = ['perfect'] as const;
export type ThemeFamilyKey = (typeof THEME_FAMILY_KEYS)[number];

/**
 * Keys that may be stored in the database. The legacy keys are still accepted
 * by the API and kept as stored (no migration), but render as `perfect`.
 */
export const LEGACY_THEME_FAMILY_KEYS = ['noir', 'nefes', 'saha', 'atolye'] as const;
export const STORED_THEME_FAMILY_KEYS = [...THEME_FAMILY_KEYS, ...LEGACY_THEME_FAMILY_KEYS] as const;
export type StoredThemeFamilyKey = (typeof STORED_THEME_FAMILY_KEYS)[number];

export const COLOR_SCHEME_PREFERENCES = ['SYSTEM', 'LIGHT', 'DARK'] as const;
export type ColorSchemePreference = (typeof COLOR_SCHEME_PREFERENCES)[number];
export type ColorMode = 'light' | 'dark';

/** Neutral colors of one mode, in the names the apps have always used. */
export interface ThemeColors {
  /** Page background (`--pui-bg`). */
  background: string;
  /** Card and panel background; the kit draws cards on the page color. */
  surface: string;
  /** `--pui-bg-muted`: card headers, addons, striped rows. */
  surfaceMuted: string;
  /** `--pui-bg-emphasis`: pressed and selected neutrals. */
  surfaceEmphasis: string;
  border: string;
  textPrimary: string;
  /** The kit has no secondary text token; this is the text color at 80%. */
  textSecondary: string;
  textMuted: string;
}

/** Semantic color roles of Perfect UI, one value per mode. */
export interface PerfectRoleColors {
  theme: string;
  success: string;
  warn: string;
  error: string;
  muted: string;
}

export interface GradientPreset {
  key: string;
  label: string;
  angle: number;
  stops: readonly [string, string, ...string[]];
}

export interface ThemeFont {
  /** CSS font-family stack for web. */
  web: string;
  /** Font names registered on mobile (expo-google-fonts export names). */
  native: { regular: string; strong: string };
  weight: '400' | '500' | '600' | '700' | '800';
  /** em units */
  letterSpacing: number;
}

export interface ThemeFamily {
  key: ThemeFamilyKey;
  label: string;
  description: string;
  recommendedFor: string;
  /** Web fonts are self-hosted through @fontsource; kept for reference only. */
  googleFonts: readonly string[];
  fonts: { display: ThemeFont; body: ThemeFont };
  radii: { card: number; button: number; chip: number; input: number };
  /** Hairline border around cards, or elevation only. */
  cardBorder: boolean;
  cardShadow: 'none' | 'soft';
  /** Display type is set wide (font-stretch) where the platform supports it. */
  wideDisplay: boolean;
  colors: Record<ColorMode, ThemeColors>;
  roles: Record<ColorMode, PerfectRoleColors>;
  /** The gradient of the default brand color; tenants get one derived from their primary. */
  gradients: readonly [GradientPreset, ...GradientPreset[]];
}

/**
 * Perfect UI tokens, exactly as `@chrissgon/perfectui` 1.0.0
 * dist/css/core.css (`light-dark(light, dark)` pairs). Web reads them as
 * `--pui-*` variables, mobile reads the hex values.
 */
export const PERFECT_UI_TOKENS = {
  colors: {
    light: {
      bg: '#ffffff',
      bgMuted: '#f3f4f6',
      bgEmphasis: '#e5e7eb',
      text: '#000000',
      textMuted: '#676d7b',
      border: '#d1d5db',
      theme: '#0092cd',
      success: '#16a34a',
      warn: '#d97706',
      error: '#dc2626',
      muted: '#6b7280',
    },
    dark: {
      bg: '#000000',
      bgMuted: '#111827',
      bgEmphasis: '#1f2937',
      text: '#ffffff',
      textMuted: '#9ca3af',
      border: '#374151',
      theme: '#07b6f0',
      success: '#22c55e',
      warn: '#f59e0b',
      error: '#ef4444',
      muted: '#9ca3af',
    },
  },
  /** px; `--pui-radius: .375rem`. Cards use 1.5x. */
  radius: 6,
  /** px; `--pui-space: .25rem`. Every gap and padding is a multiple of it. */
  space: 4,
  /** px; `--pui-font-size: .875rem`. */
  fontSize: 14,
  /** px; `--pui-border-width: 1px`. */
  borderWidth: 1,
  /** px; Lucide icons at 16px with the stroke bound to the text color. */
  iconSize: 16,
  fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
} as const;

export type PerfectUiColorToken = keyof (typeof PERFECT_UI_TOKENS)['colors']['light'];

const L = PERFECT_UI_TOKENS.colors.light;
const D = PERFECT_UI_TOKENS.colors.dark;

export const THEME_FAMILIES = {
  perfect: {
    key: 'perfect',
    label: 'Perfect UI',
    description: 'Flat, quiet and legible: one typeface (Inter), hairline cards and the business color.',
    recommendedFor: 'Every business type',
    googleFonts: ['Inter:wght@400;500;600;700'],
    fonts: {
      display: {
        web: PERFECT_UI_TOKENS.fontFamily,
        // Mobile keeps its bundled faces until phase T5 moves it to Inter.
        native: { regular: 'Manrope_600SemiBold', strong: 'Manrope_800ExtraBold' },
        weight: '700',
        letterSpacing: -0.01,
      },
      body: {
        web: PERFECT_UI_TOKENS.fontFamily,
        native: { regular: 'Manrope_400Regular', strong: 'Manrope_600SemiBold' },
        weight: '400',
        letterSpacing: 0,
      },
    },
    radii: {
      card: PERFECT_UI_TOKENS.radius * 1.5,
      button: PERFECT_UI_TOKENS.radius,
      chip: 9999,
      input: PERFECT_UI_TOKENS.radius,
    },
    cardBorder: true,
    cardShadow: 'none',
    wideDisplay: false,
    colors: {
      light: {
        background: L.bg,
        surface: L.bg,
        surfaceMuted: L.bgMuted,
        surfaceEmphasis: L.bgEmphasis,
        border: L.border,
        textPrimary: L.text,
        textSecondary: '#333333',
        textMuted: L.textMuted,
      },
      dark: {
        background: D.bg,
        surface: D.bg,
        surfaceMuted: D.bgMuted,
        surfaceEmphasis: D.bgEmphasis,
        border: D.border,
        textPrimary: D.text,
        textSecondary: '#cccccc',
        textMuted: D.textMuted,
      },
    },
    roles: {
      light: { theme: L.theme, success: L.success, warn: L.warn, error: L.error, muted: L.muted },
      dark: { theme: D.theme, success: D.success, warn: D.warn, error: D.error, muted: D.muted },
    },
    gradients: [{ key: 'perfect-brand', label: 'Perfect UI', angle: 135, stops: ['#0092cd', '#005c81'] }],
  },
} as const satisfies Record<ThemeFamilyKey, ThemeFamily>;

export const DEFAULT_THEME_FAMILY: ThemeFamilyKey = 'perfect';

/** Any key, including a legacy or unknown one, resolves to the single family. */
export function getThemeFamily(key: string | null | undefined): ThemeFamily {
  return (THEME_FAMILY_KEYS as readonly string[]).includes(key ?? '')
    ? THEME_FAMILIES[key as ThemeFamilyKey]
    : THEME_FAMILIES[DEFAULT_THEME_FAMILY];
}

/** True for every key the API stores, current or legacy. */
export function isStoredThemeFamilyKey(value: string | null | undefined): value is StoredThemeFamilyKey {
  return !!value && (STORED_THEME_FAMILY_KEYS as readonly string[]).includes(value);
}
