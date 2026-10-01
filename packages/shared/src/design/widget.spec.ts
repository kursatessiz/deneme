import { MIN_TEXT_CONTRAST, wcagContrast } from './brand';
import { PERFECT_UI_TOKENS, THEME_FAMILIES } from './themes';
import { WIDGET_PALETTE, widgetPalette } from './widget';

describe('widget palette', () => {
  it('is the perfect family in light and dark, as plain hex strings', () => {
    for (const mode of ['light', 'dark'] as const) {
      const p = WIDGET_PALETTE[mode];
      const fam = THEME_FAMILIES.perfect.colors[mode];
      expect(p.background).toBe(fam.background);
      expect(p.text).toBe(fam.textPrimary);
      expect(p.textMuted).toBe(fam.textMuted);
      expect(p.border).toBe(fam.border);
      expect(p.theme).toBe(PERFECT_UI_TOKENS.colors[mode].theme);
      expect(p.onTheme).toBe(fam.background);
      for (const value of Object.values(p)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(WIDGET_PALETTE.light.background).toBe('#ffffff');
    expect(WIDGET_PALETTE.dark.background).toBe('#000000');
  });

  it('keeps text readable on the background in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const p = WIDGET_PALETTE[mode];
      expect(wcagContrast(p.text, p.background)).toBeGreaterThanOrEqual(7);
      expect(wcagContrast(p.textMuted, p.background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      expect(wcagContrast(p.themeText, p.background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it('applies the studio primary color with the same contrast correction as the app', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const primary of ['#ff0000', '#ffff00', '#1a1a1a', '#c8443c']) {
        const p = widgetPalette(mode, primary);
        expect(wcagContrast(p.onTheme, p.theme)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        expect(wcagContrast(p.themeText, p.background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        // The background and the neutrals never change with the brand.
        expect(p.background).toBe(WIDGET_PALETTE[mode].background);
        expect(p.border).toBe(WIDGET_PALETTE[mode].border);
      }
    }
    expect(widgetPalette('light', '#c8443c').theme).toBe('#c8443c');
    expect(widgetPalette('light', null)).toEqual(WIDGET_PALETTE.light);
  });
});
