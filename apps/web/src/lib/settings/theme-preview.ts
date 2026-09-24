import { THEME_FAMILIES, getThemeFamily, resolveTheme, themeCssVariables } from '@platform/shared';
import type { GradientPreset, ResolvedTheme, ThemeFamilyKey, TenantTheme } from '@platform/shared';

/** Gradient presets that belong to a theme family, in declaration order -- what the "Görünüm" family+gradient picker offers. */
export function gradientPresetsForFamily(family: ThemeFamilyKey): readonly GradientPreset[] {
  return THEME_FAMILIES[family].gradients;
}

/** The gradient preset a family switch should fall back to when the previously chosen preset does not belong to the new family. */
export function defaultGradientForFamily(family: ThemeFamilyKey): GradientPreset {
  return getThemeFamily(family).gradients[0];
}

/**
 * Builds the live studio-theme preview shown next to the "Görünüm" form: the
 * in-progress (possibly unsaved) form values resolved exactly the way
 * ThemeRoot resolves the real tenant theme, always in light mode so the
 * preview is stable regardless of the viewer's OS setting.
 */
export function previewThemeFromForm(form: TenantTheme): ResolvedTheme {
  return resolveTheme({ tenant: form, appearance: { themeFamily: null, colorScheme: 'LIGHT' }, systemMode: 'light' });
}

export function previewCssVariables(form: TenantTheme): Record<string, string> {
  return themeCssVariables(previewThemeFromForm(form));
}
