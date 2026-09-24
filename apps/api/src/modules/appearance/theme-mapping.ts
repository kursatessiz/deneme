import {
  AppearancePreferenceSchema,
  DEFAULT_APPEARANCE,
  DEFAULT_TENANT_THEME,
  TenantThemeSchema,
} from '@platform/shared';
import type { AppearancePreference, TenantTheme } from '@platform/shared';

/** Studio row -> validated theme. A stale stored value falls back to the default instead of leaking out. */
export function toTenantTheme(studio: {
  logoUrl: string | null;
  themeFamily: string;
  themePrimary: string;
  gradientPresetKey: string;
}): TenantTheme {
  const parsed = TenantThemeSchema.safeParse({
    logoUrl: studio.logoUrl,
    themeFamily: studio.themeFamily,
    themePrimary: studio.themePrimary,
    gradientPresetKey: studio.gradientPresetKey,
  });
  return parsed.success ? parsed.data : { ...DEFAULT_TENANT_THEME, logoUrl: studio.logoUrl };
}

export function toAppearance(user: { themeFamily: string | null; colorScheme: string }): AppearancePreference {
  const parsed = AppearancePreferenceSchema.safeParse({ themeFamily: user.themeFamily, colorScheme: user.colorScheme });
  return parsed.success ? parsed.data : DEFAULT_APPEARANCE;
}
