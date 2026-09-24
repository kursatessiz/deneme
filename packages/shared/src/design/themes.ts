/**
 * Theme families. A tenant picks the default family for its apps; each user
 * may override the family and the light/dark mode on their own device. The
 * tenant's brand (primary color, gradient preset, logo) always stays the
 * tenant's, whichever family renders it.
 */

export const THEME_FAMILY_KEYS = ['noir', 'nefes', 'saha', 'atolye'] as const;
export type ThemeFamilyKey = (typeof THEME_FAMILY_KEYS)[number];

export const COLOR_SCHEME_PREFERENCES = ['SYSTEM', 'LIGHT', 'DARK'] as const;
export type ColorSchemePreference = (typeof COLOR_SCHEME_PREFERENCES)[number];
export type ColorMode = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
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
  /** Google Fonts css2 family query used by web, e.g. "Manrope:wght@400;600;800". */
  googleFonts: readonly string[];
  fonts: { display: ThemeFont; body: ThemeFont };
  radii: { card: number; button: number; chip: number; input: number };
  /** Hairline border around cards, or elevation only. */
  cardBorder: boolean;
  cardShadow: 'none' | 'soft';
  /** Display type is set wide (font-stretch) where the platform supports it. */
  wideDisplay: boolean;
  colors: Record<ColorMode, ThemeColors>;
  gradients: readonly [GradientPreset, ...GradientPreset[]];
}

const grad = (key: string, label: string, from: string, to: string): GradientPreset => ({
  key,
  label,
  angle: 135,
  stops: [from, to],
});

export const THEME_FAMILIES = {
  noir: {
    key: 'noir',
    label: 'Stüdyo Noir',
    description: 'Ciddi, premium ve editoryal. Siyah beyaz zemin, tek güçlü vurgu rengi, ince çizgili kartlar.',
    recommendedFor: 'Premium pilates ve reformer, PT stüdyoları, dövüş sanatları',
    googleFonts: ['Schibsted Grotesk:wght@600;800', 'Figtree:wght@400;600'],
    fonts: {
      display: {
        web: '"Schibsted Grotesk", system-ui, sans-serif',
        native: { regular: 'SchibstedGrotesk_600SemiBold', strong: 'SchibstedGrotesk_800ExtraBold' },
        weight: '800',
        letterSpacing: -0.01,
      },
      body: {
        web: '"Figtree", system-ui, sans-serif',
        native: { regular: 'Figtree_400Regular', strong: 'Figtree_600SemiBold' },
        weight: '400',
        letterSpacing: 0,
      },
    },
    radii: { card: 12, button: 24, chip: 999, input: 12 },
    cardBorder: true,
    cardShadow: 'none',
    wideDisplay: false,
    colors: {
      light: {
        background: '#FAFAF8',
        surface: '#FFFFFF',
        surfaceMuted: '#F0EFEC',
        border: '#E4E2DC',
        textPrimary: '#17160F',
        textSecondary: '#5F5C54',
        textMuted: '#7A776E',
      },
      dark: {
        background: '#0E0E0C',
        surface: '#171613',
        surfaceMuted: '#201F1B',
        border: '#2A2825',
        textPrimary: '#F5F3EE',
        textSecondary: '#B3AFA4',
        textMuted: '#8A867B',
      },
    },
    gradients: [
      grad('noir-kiremit', 'Kiremit', '#C8443C', '#7E2A24'),
      grad('noir-zumrut', 'Zümrüt', '#1F6F5C', '#123D33'),
      grad('noir-gece', 'Gece mavisi', '#2B4C7E', '#17304F'),
      grad('noir-kehribar', 'Kehribar', '#B8860B', '#6B4D08'),
      grad('noir-grafit', 'Grafit', '#4A4A4A', '#141414'),
    ],
  },
  nefes: {
    key: 'nefes',
    label: 'Nefes',
    description: 'Sakin ve iyileştirici. Sıcak kırık beyaz, yumuşak köşeler, serif başlıklarla samimi bir ton.',
    recommendedFor: 'Yoga, wellness ve spa, fizyoterapi, müzik ve dil kursları',
    googleFonts: ['Fraunces:wght@600', 'Nunito Sans:wght@400;700'],
    fonts: {
      display: {
        web: '"Fraunces", Georgia, serif',
        native: { regular: 'Fraunces_600SemiBold', strong: 'Fraunces_600SemiBold' },
        weight: '600',
        letterSpacing: 0,
      },
      body: {
        web: '"Nunito Sans", system-ui, sans-serif',
        native: { regular: 'NunitoSans_400Regular', strong: 'NunitoSans_700Bold' },
        weight: '400',
        letterSpacing: 0,
      },
    },
    radii: { card: 20, button: 20, chip: 999, input: 16 },
    cardBorder: false,
    cardShadow: 'soft',
    wideDisplay: false,
    colors: {
      light: {
        background: '#FBF8F4',
        surface: '#FFFFFF',
        surfaceMuted: '#F3EEE6',
        border: '#E8E0D3',
        textPrimary: '#2B271F',
        textSecondary: '#655C4D',
        textMuted: '#7D7462',
      },
      dark: {
        background: '#14130F',
        surface: '#1D1B16',
        surfaceMuted: '#262319',
        border: '#2E2B23',
        textPrimary: '#F6F1E6',
        textSecondary: '#BDB39D',
        textMuted: '#948B75',
      },
    },
    gradients: [
      grad('nefes-adacayi', 'Adaçayı', '#6E8B6B', '#3F5A3D'),
      grad('nefes-seftali', 'Şeftali', '#E8A87C', '#C0703F'),
      grad('nefes-gok', 'Gökyüzü', '#7C9CBF', '#4A6C8C'),
      grad('nefes-lavanta', 'Lavanta', '#B79FC9', '#7C5F94'),
      grad('nefes-bugday', 'Buğday', '#D9C08A', '#A67C3D'),
    ],
  },
  saha: {
    key: 'saha',
    label: 'Saha',
    description: 'Enerjik ve performans odaklı. Keskin köşeler, geniş başlıklar, yüksek kontrastlı durum etiketleri.',
    recommendedFor: 'Tenis ve padel kortları, yüzme okulları, grup fitness, çocuk spor merkezleri',
    googleFonts: ['Archivo:wdth,wght@125,800', 'IBM Plex Sans:wght@400;600'],
    fonts: {
      display: {
        web: '"Archivo", system-ui, sans-serif',
        native: { regular: 'Archivo_700Bold', strong: 'Archivo_800ExtraBold' },
        weight: '800',
        letterSpacing: 0.005,
      },
      body: {
        web: '"IBM Plex Sans", system-ui, sans-serif',
        native: { regular: 'IBMPlexSans_400Regular', strong: 'IBMPlexSans_600SemiBold' },
        weight: '400',
        letterSpacing: 0,
      },
    },
    radii: { card: 8, button: 8, chip: 6, input: 8 },
    cardBorder: false,
    cardShadow: 'none',
    wideDisplay: true,
    colors: {
      light: {
        background: '#FFFFFF',
        surface: '#F2F4F3',
        surfaceMuted: '#E1E5E3',
        border: '#E1E5E3',
        textPrimary: '#131816',
        textSecondary: '#4F5B57',
        textMuted: '#66726E',
      },
      dark: {
        background: '#0C0F0E',
        surface: '#151A18',
        surfaceMuted: '#1E2523',
        border: '#1E2523',
        textPrimary: '#F1F4F2',
        textSecondary: '#B4BDB7',
        textMuted: '#8F9891',
      },
    },
    gradients: [
      grad('saha-turuncu', 'Turuncu', '#E8622C', '#B8401A'),
      grad('saha-yesil', 'Çim', '#1FA37A', '#0D6B4C'),
      grad('saha-mavi', 'Havuz', '#2B74B9', '#164A78'),
      grad('saha-sari', 'Sarı', '#E8B92C', '#A87808'),
      grad('saha-komur', 'Kömür', '#4C4C4C', '#0F0F0F'),
    ],
  },
  atolye: {
    key: 'atolye',
    label: 'Atölye',
    description: 'Sıcak, güven veren, her sektöre uyan. Bol boşluk, orta köşe, tek yazı ailesi.',
    recommendedFor: 'Fizyoterapi, coworking, kurslar ve güçlü bir kimliği olmayan her işletme',
    googleFonts: ['Manrope:wght@400;600;800'],
    fonts: {
      display: {
        web: '"Manrope", system-ui, sans-serif',
        native: { regular: 'Manrope_600SemiBold', strong: 'Manrope_800ExtraBold' },
        weight: '800',
        letterSpacing: -0.01,
      },
      body: {
        web: '"Manrope", system-ui, sans-serif',
        native: { regular: 'Manrope_400Regular', strong: 'Manrope_600SemiBold' },
        weight: '400',
        letterSpacing: 0,
      },
    },
    radii: { card: 16, button: 16, chip: 999, input: 12 },
    cardBorder: true,
    cardShadow: 'soft',
    wideDisplay: false,
    colors: {
      light: {
        background: '#F7F6F4',
        surface: '#FFFFFF',
        surfaceMuted: '#ECEAE6',
        border: '#ECEAE6',
        textPrimary: '#262319',
        textSecondary: '#5E594D',
        textMuted: '#777163',
      },
      dark: {
        background: '#121110',
        surface: '#1B1A17',
        surfaceMuted: '#252420',
        border: '#2A2824',
        textPrimary: '#F3F1EC',
        textSecondary: '#B9B3A5',
        textMuted: '#948E80',
      },
    },
    gradients: [
      grad('atolye-orman', 'Orman', '#2F6F5E', '#173D33'),
      grad('atolye-kil', 'Kil', '#C0572A', '#8A3D1C'),
      grad('atolye-lacivert', 'Lacivert', '#3A5A8C', '#1F3654'),
      grad('atolye-toprak', 'Toprak', '#8A6D3A', '#5C481F'),
      grad('atolye-duman', 'Duman', '#6B6B6B', '#252525'),
    ],
  },
} as const satisfies Record<ThemeFamilyKey, ThemeFamily>;

export const DEFAULT_THEME_FAMILY: ThemeFamilyKey = 'atolye';

export function getThemeFamily(key: string | null | undefined): ThemeFamily {
  return (THEME_FAMILY_KEYS as readonly string[]).includes(key ?? '')
    ? THEME_FAMILIES[key as ThemeFamilyKey]
    : THEME_FAMILIES[DEFAULT_THEME_FAMILY];
}
