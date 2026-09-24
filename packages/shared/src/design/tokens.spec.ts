import {
  GRADIENT_PRESETS,
  TenantThemeSchema,
  DEFAULT_TENANT_THEME,
  contrastRatio,
  gradientCss,
  onColor,
  palette,
  semanticColors,
  resolveTheme,
  familyOfGradient,
  themeCssVariables,
  AppearancePreferenceSchema,
} from './tokens';
import { THEME_FAMILIES, THEME_FAMILY_KEYS } from './themes';

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

  it('rejects a gradient from another family', () => {
    expect(
      TenantThemeSchema.safeParse({ ...DEFAULT_TENANT_THEME, themeFamily: 'noir', gradientPresetKey: 'atolye-kil' }).success,
    ).toBe(false);
    expect(
      TenantThemeSchema.safeParse({ ...DEFAULT_TENANT_THEME, themeFamily: 'noir', gradientPresetKey: 'noir-zumrut' }).success,
    ).toBe(true);
  });

  it('every family has five gradients that belong to it', () => {
    for (const key of THEME_FAMILY_KEYS) {
      expect(THEME_FAMILIES[key].gradients).toHaveLength(5);
      for (const g of THEME_FAMILIES[key].gradients) expect(familyOfGradient(g.key)).toBe(key);
    }
  });

  it('every family keeps text readable in light and dark', () => {
    for (const key of THEME_FAMILY_KEYS) {
      for (const mode of ['light', 'dark'] as const) {
        const c = THEME_FAMILIES[key].colors[mode];
        for (const bg of [c.background, c.surface, c.surfaceMuted]) {
          expect(contrastRatio(c.textPrimary, bg)).toBeGreaterThanOrEqual(7);
          expect(contrastRatio(c.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(c.textMuted, bg)).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('gradient start colors carry readable button text', () => {
    for (const key of THEME_FAMILY_KEYS) {
      for (const g of THEME_FAMILIES[key].gradients) {
        const text = onColor(g.stops[0]);
        expect(contrastRatio(text, g.stops[0])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('resolveTheme: tenant family by default, user override keeps tenant brand', () => {
    const tenant = { ...DEFAULT_TENANT_THEME, themeFamily: 'saha' as const, gradientPresetKey: 'saha-mavi' as const, themePrimary: '#2B74B9' };
    const byTenant = resolveTheme({ tenant, appearance: null, systemMode: 'dark' });
    expect(byTenant.family.key).toBe('saha');
    expect(byTenant.mode).toBe('dark');
    expect(byTenant.colors.background).toBe(THEME_FAMILIES.saha.colors.dark.background);

    const byUser = resolveTheme({ tenant, appearance: { themeFamily: 'nefes', colorScheme: 'LIGHT' }, systemMode: 'dark' });
    expect(byUser.family.key).toBe('nefes');
    expect(byUser.mode).toBe('light');
    expect(byUser.gradient.key).toBe('saha-mavi');
    expect(byUser.colors.primary).toBe('#2B74B9');
  });

  it('resolveTheme never throws on stale values', () => {
    const t = resolveTheme({
      tenant: { themeFamily: 'eski' as never, gradientPresetKey: 'sage' as never, themePrimary: 'x' },
      appearance: { themeFamily: 'yok' as never },
      systemMode: null,
    });
    expect(t.family.key).toBe('atolye');
    expect(t.gradient.key).toBe('atolye-orman');
    expect(t.colors.primary).toBe(DEFAULT_TENANT_THEME.themePrimary);
    expect(Object.keys(themeCssVariables(t))).toContain('--gradient-brand');
  });

  it('appearance schema accepts follow-tenant and rejects unknown families', () => {
    expect(AppearancePreferenceSchema.safeParse({ themeFamily: null, colorScheme: 'SYSTEM' }).success).toBe(true);
    expect(AppearancePreferenceSchema.safeParse({ themeFamily: 'mor', colorScheme: 'SYSTEM' }).success).toBe(false);
  });

  it('builds CSS gradients from presets', () => {
    expect(gradientCss('atolye-orman')).toBe('linear-gradient(135deg, #2F6F5E, #173D33)');
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
