'use client';

import { useEffect, useMemo, useState } from 'react';
import { resolveTheme, themeColorScheme, themeCssVariables, themePuiMode } from '@platform/shared';
import type { AppearancePreference, ColorMode, TenantThemeInput } from '@platform/shared';

/**
 * Applies the design system to a subtree: the Perfect UI tokens with the
 * tenant's primary color as `--pui-theme`, the legacy `--color-*` aliases,
 * and the user's light/dark/system choice.
 *
 * <html> sits outside this wrapper, so the wrapper carries the mode itself:
 * `data-pui-mode` (light or dark; absent for "system") and `color-scheme`
 * (light, dark, or "light dark" to follow the OS). Every token is a
 * `light-dark()` pair, which resolves against the `color-scheme` of the
 * element that uses it, so the whole subtree, dialogs and popovers
 * included, follows this wrapper. Only this subtree is themed; the public
 * booking page and the embed widget resolve their own studio.
 */
export function ThemeRoot({
  tenantTheme,
  appearance,
  children,
}: {
  tenantTheme: TenantThemeInput | null;
  appearance: Pick<AppearancePreference, 'colorScheme'> & Partial<AppearancePreference>;
  children: React.ReactNode;
}) {
  const [systemMode, setSystemMode] = useState<ColorMode>('light');

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemMode(mql.matches ? 'dark' : 'light');
    const onChange = (e: MediaQueryListEvent) => setSystemMode(e.matches ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const resolved = useMemo(
    () => resolveTheme({ tenant: tenantTheme, appearance, systemMode }),
    [tenantTheme, appearance, systemMode],
  );
  const vars = useMemo(() => themeCssVariables(resolved), [resolved]);

  return (
    <div
      data-pui-mode={themePuiMode(appearance.colorScheme)}
      data-color-scheme={resolved.mode}
      className={resolved.mode === 'dark' ? 'dark' : undefined}
      style={{
        ...(vars as React.CSSProperties),
        colorScheme: themeColorScheme(appearance.colorScheme),
        fontFamily: 'var(--font-body)',
        fontSize: 'var(--pui-font-size)',
        backgroundColor: 'var(--pui-bg)',
        color: 'var(--pui-text)',
        minHeight: '100vh',
      }}
    >
      {children}
    </div>
  );
}
