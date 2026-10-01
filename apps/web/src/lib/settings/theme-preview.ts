import { resolveTheme, themeCssVariables } from '@platform/shared';
import type { ResolvedTheme, TenantThemeView } from '@platform/shared';

/**
 * Builds the live studio-theme preview shown next to the "Görünüm" form: the
 * in-progress (possibly unsaved) form values resolved exactly the way
 * ThemeRoot resolves the real tenant theme, always in light mode so the
 * preview is stable regardless of the viewer's OS setting.
 */
export function previewThemeFromForm(form: TenantThemeView): ResolvedTheme {
  return resolveTheme({ tenant: form, appearance: { colorScheme: 'LIGHT' }, systemMode: 'light' });
}

export function previewCssVariables(form: TenantThemeView): Record<string, string> {
  return themeCssVariables(previewThemeFromForm(form));
}
