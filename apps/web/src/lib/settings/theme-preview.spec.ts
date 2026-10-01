import { DEFAULT_TENANT_THEME, PERFECT_UI_TOKENS, gradientCss } from '@platform/shared';
import { previewCssVariables, previewThemeFromForm } from './theme-preview';

describe('previewThemeFromForm / previewCssVariables', () => {
  it('resolves the form values in light mode, ignoring any device preference', () => {
    const preview = previewThemeFromForm(DEFAULT_TENANT_THEME);
    expect(preview.mode).toBe('light');
    expect(preview.family.key).toBe('perfect');
    expect(preview.colors.primary).toBe(PERFECT_UI_TOKENS.colors.light.theme);
  });

  it('renders a legacy family with the single design language', () => {
    const preview = previewThemeFromForm({ ...DEFAULT_TENANT_THEME, themeFamily: 'saha', gradientPresetKey: 'saha-mavi' });
    expect(preview.family.key).toBe('perfect');
  });

  it('reflects an in-progress (unsaved) color: brand variable and the derived gradient', () => {
    const vars = previewCssVariables({ ...DEFAULT_TENANT_THEME, themePrimary: '#112233' });
    expect(vars['--pui-theme']).toBe('#112233');
    expect(vars['--color-primary']).toBe('var(--pui-theme)');
    expect(vars['--gradient-brand']).toBe(gradientCss('#112233'));
  });
});
