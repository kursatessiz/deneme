import {
  GRADIENT_PRESETS,
  TenantThemeSchema,
  DEFAULT_TENANT_THEME,
  contrastRatio,
  gradientCss,
  onColor,
  palette,
  semanticColors,
} from './tokens';

describe('design tokens', () => {
  it('has unique gradient preset keys', () => {
    const keys = GRADIENT_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('accepts the default theme and rejects free-form values', () => {
    expect(TenantThemeSchema.parse(DEFAULT_TENANT_THEME)).toEqual(DEFAULT_TENANT_THEME);
    expect(TenantThemeSchema.safeParse({ ...DEFAULT_TENANT_THEME, themePrimary: 'purple' }).success).toBe(false);
    expect(TenantThemeSchema.safeParse({ ...DEFAULT_TENANT_THEME, gradientPresetKey: 'neon' }).success).toBe(false);
  });

  it('builds CSS gradients from presets', () => {
    expect(gradientCss('sage')).toBe('linear-gradient(135deg, #3f6b52, #9cbfa7)');
  });

  it('keeps body text readable (WCAG AA) in both schemes', () => {
    for (const scheme of Object.values(semanticColors)) {
      expect(contrastRatio(scheme.textPrimary, scheme.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(scheme.textSecondary, scheme.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('picks a readable text color on tenant primaries', () => {
    expect(onColor('#1d4e89')).toBe(palette.white);
    expect(onColor('#e3c9a0')).toBe(palette.ink[950]);
  });
});
