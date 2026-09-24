import { createContext, createElement, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import type { TextStyle } from 'react-native';

import {
  DEFAULT_APPEARANCE,
  palette,
  radii,
  resolveTheme,
  spacing,
  typography,
} from '@platform/shared';
import type { AppearancePreference, ResolvedTheme } from '@platform/shared';

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

/** Semantic colors of the active theme. Never hardcode colors. */
export function useThemeColors(): ResolvedTheme['colors'] {
  return useTheme().theme.colors;
}

/** Text styles bound to the active theme family's fonts; system fonts until they load. */
export function useThemeFonts(): { display: TextStyle; body: TextStyle; bodyStrong: TextStyle } {
  const { theme, fontsLoaded } = useTheme();
  const { family } = theme;
  return useMemo(() => {
    if (!fontsLoaded) {
      return {
        display: { fontWeight: typography.weight.bold },
        body: {},
        bodyStrong: { fontWeight: typography.weight.semibold },
      };
    }
    return {
      display: {
        fontFamily: family.fonts.display.native.strong,
        letterSpacing: family.fonts.display.letterSpacing * typography.size.xl,
      },
      body: { fontFamily: family.fonts.body.native.regular },
      bodyStrong: { fontFamily: family.fonts.body.native.strong },
    };
  }, [family, fontsLoaded]);
}

export { palette, radii, spacing, typography };
