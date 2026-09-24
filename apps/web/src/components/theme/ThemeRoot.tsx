'use client';

import { useEffect, useMemo, useState } from 'react';
import { resolveTheme, themeCssVariables } from '@platform/shared';
import type { AppearancePreference, ColorMode, TenantTheme } from '@platform/shared';
import { FAMILY_FONT_VARIABLES } from '@/lib/fonts';

/**
 * Applies the resolved theme (tenant brand + the user's appearance
 * preference) as CSS custom properties on a wrapper, and the matching
 * family's font variables. Only this subtree is themed -- the rest of the
 * app (the public booking page, the embed widget) resolves its own theme
 * from its own studio.
 */
export function ThemeRoot({
  tenantTheme,
  appearance,
  children,
}: {
  tenantTheme: TenantTheme;
  appearance: AppearancePreference;
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
  const fonts = FAMILY_FONT_VARIABLES[resolved.family.key];

  return (
    <div
      data-color-scheme={resolved.mode}
      className={resolved.mode === 'dark' ? 'dark' : undefined}
      style={{
        ...(vars as React.CSSProperties),
        fontFamily: fonts.body,
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-text-primary)',
        minHeight: '100vh',
      }}
    >
      {children}
    </div>
  );
}
