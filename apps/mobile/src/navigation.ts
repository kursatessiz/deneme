import { useMemo } from 'react';

import { toneColors } from './components/tones';
import { borderWidth, typography, useTheme, useThemeFonts } from './theme';

/**
 * Header and tab bar styling from the design tokens: page-colored surface,
 * 1px bottom border (no shadow), Inter titles, and the tenant color (or the
 * text color when the tenant color is too pale to read) as the active tint.
 */
export function useNavigationStyle() {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const accent = toneColors(theme, 'theme').ink;
  return useMemo(
    () => ({
      accent,
      stack: {
        headerStyle: { backgroundColor: c.surface },
        headerShadowVisible: false,
        headerTintColor: accent,
        headerTitleStyle: { ...fonts.bodyStrong, color: c.textPrimary, fontSize: typography.size.md },
        contentStyle: { backgroundColor: c.background },
      },
      tabs: {
        headerStyle: { backgroundColor: c.surface, borderBottomWidth: borderWidth, borderBottomColor: c.border },
        headerShadowVisible: false,
        headerTitleStyle: { ...fonts.bodyStrong, color: c.textPrimary, fontSize: typography.size.md },
        sceneStyle: { backgroundColor: c.background },
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, borderTopWidth: borderWidth },
        tabBarActiveTintColor: accent,
        tabBarInactiveTintColor: c.textMuted,
        tabBarLabelStyle: { ...fonts.bodyMedium, fontSize: typography.size.xs },
      },
    }),
    [c, accent, fonts],
  );
}
