import { createContext, createElement, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import type { TextStyle } from 'react-native';

import {
  DEFAULT_APPEARANCE,
  PERFECT_UI_TOKENS,
  palette,
  radii,
  resolveTheme,
  spacing,
  typography as sharedTypography,
} from '@platform/shared';
import type { AppearancePreference, ResolvedTheme } from '@platform/shared';

import { INTER_FACE } from './interFaces';
import { apiRequest } from './lib/api';
import { useSession } from './lib/session';

export type AppColorScheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: ResolvedTheme;
  fontsLoaded: boolean;
  appearance: AppearancePreference;
  /** Saves the user's choice on the server; the UI switches immediately. */
  setAppearance: (next: AppearancePreference) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Resolves the active theme from the active studio's brand, the user's own
 * appearance choice and the OS light/dark mode. Must sit inside
 * SessionProvider.
 */
export function ThemeProvider({ children, fontsLoaded }: { children: ReactNode; fontsLoaded: boolean }): ReactElement {
  const system = useColorScheme();
  const { user, activeMembership, refreshUser } = useSession();
  // Optimistic value while a save is in flight; the session copy wins afterwards.
  const [pending, setPending] = useState<AppearancePreference | null>(null);

  const appearance = pending ?? user?.appearance ?? DEFAULT_APPEARANCE;
  const theme = useMemo(
    () =>
      resolveTheme({
        tenant: activeMembership?.theme ?? null,
        appearance,
        systemMode: system === 'dark' ? 'dark' : 'light',
      }),
    [activeMembership?.theme, appearance, system],
  );

  const setAppearance = useCallback(
    async (next: AppearancePreference) => {
      setPending(next);
      try {
        await apiRequest<AppearancePreference>('/me/appearance', { method: 'PUT', body: next });
        await refreshUser();
      } finally {
        setPending(null);
      }
    },
    [refreshUser],
  );

  const value = useMemo(
    () => ({ theme, fontsLoaded, appearance, setAppearance }),
    [theme, fontsLoaded, appearance, setAppearance],
  );
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

/** True once Inter has loaded; false outside a ThemeProvider (e.g. the root error fallback). */
export function useFontsLoaded(): boolean {
  return useContext(ThemeContext)?.fontsLoaded ?? false;
}

/** Semantic colors of the active theme. Never hardcode colors. */
export function useThemeColors(): ResolvedTheme['colors'] {
  return useTheme().theme.colors;
}

/**
 * Type scale of the app: 12 / 14 / 16 / 20 / 24, the base being the kit's 14.
 * (The shared scale carries web display sizes the mobile app does not use.)
 */
export const typography = {
  ...sharedTypography,
  size: { xs: 12, sm: PERFECT_UI_TOKENS.fontSize, md: 16, lg: 20, xl: 24 },
} as const;

/** Border width of the kit (1px); every card, input and divider uses it. */
export const borderWidth = PERFECT_UI_TOKENS.borderWidth;

/** Dimming layer behind modals and sheets (black at 50%, same in both modes). */
export const SCRIM = `${palette.black}80`;

/** Minimum touch target of interactive rows and controls. */
export const TOUCH_TARGET = 44;

interface ThemeFonts {
  /** Titles and numbers: Inter 700. */
  display: TextStyle;
  /** Body copy: Inter 400. */
  body: TextStyle;
  /** Labels and buttons: Inter 500. */
  bodyMedium: TextStyle;
  /** Emphasis: Inter 600. */
  bodyStrong: TextStyle;
}

/** Text styles in Inter; the system font (with matching weights) until the faces load. */
export function useThemeFonts(): ThemeFonts {
  const { fontsLoaded } = useTheme();
  return useMemo(() => {
    if (!fontsLoaded) {
      return {
        display: { fontWeight: typography.weight.bold },
        body: {},
        bodyMedium: { fontWeight: typography.weight.medium },
        bodyStrong: { fontWeight: typography.weight.semibold },
      };
    }
    return {
      display: { fontFamily: INTER_FACE.bold },
      body: { fontFamily: INTER_FACE.regular },
      bodyMedium: { fontFamily: INTER_FACE.medium },
      bodyStrong: { fontFamily: INTER_FACE.semibold },
    };
  }, [fontsLoaded]);
}

export { palette, radii, spacing };
