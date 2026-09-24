import { DEFAULT_TENANT_THEME } from '@platform/shared';
import { defaultGradientForFamily, gradientPresetsForFamily, previewCssVariables, previewThemeFromForm } from './theme-preview';

describe('gradientPresetsForFamily', () => {
  it('returns only gradients that belong to the chosen family', () => {
    for (const key of ['noir', 'nefes', 'saha', 'atolye'] as const) {
      const presets = gradientPresetsForFamily(key);
      expect(presets.length).toBeGreaterThan(0);
      expect(presets.every((p) => p.key.startsWith(key))).toBe(true);
    }
  });
});

describe('defaultGradientForFamily', () => {
  it('picks the family first preset', () => {
    expect(defaultGradientForFamily('saha').key).toBe(gradientPresetsForFamily('saha')[0].key);
  });
});

describe('previewThemeFromForm / previewCssVariables', () => {
  it('resolves the form values in light mode, ignoring any device preference', () => {
    const preview = previewThemeFromForm(DEFAULT_TENANT_THEME);
    expect(preview.mode).toBe('light');
    expect(preview.family.key).toBe(DEFAULT_TENANT_THEME.themeFamily);
    expect(preview.colors.primary).toBe(DEFAULT_TENANT_THEME.themePrimary);
  });

  it('reflects an in-progress (unsaved) color and gradient choice', () => {
    const form = { ...DEFAULT_TENANT_THEME, themeFamily: 'saha' as const, themePrimary: '#112233', gradientPresetKey: gradientPresetsForFamily('saha')[1].key };
    const vars = previewCssVariables(form);
    expect(vars['--color-primary']).toBe('#112233');
    expect(vars['--gradient-brand']).toContain('linear-gradient');
  });
});
