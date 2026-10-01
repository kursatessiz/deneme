import { PERFECT_UI_TOKENS, resolveTheme, themeCssVariables } from '@platform/shared';

/**
 * The super-admin panel (and the other platform chrome: marketing panel,
 * security screens, invite landing) is not a tenant subtree, so it gets the
 * Perfect UI defaults straight from packages/shared/src/design: kit
 * neutrals following the OS light/dark setting, and the platform tenant's
 * primary color when the layout passes it (see fetchPlatformBrand).
 */
export function AdminTheme({ primary }: { primary?: string | null }) {
  const vars = themeCssVariables(resolveTheme({ tenant: primary ? { themePrimary: primary } : null, appearance: { colorScheme: 'SYSTEM' }, systemMode: 'light' }));
  const declarations = Object.entries(vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join('\n      ');
  const css = `
    .admin-root {
      ${declarations}
      color-scheme: light dark;
      background-color: var(--pui-bg);
      color: var(--pui-text);
      font-family: ${PERFECT_UI_TOKENS.fontFamily};
      font-size: var(--pui-font-size);
      min-height: 100vh;
    }
  `;
  // eslint-disable-next-line react/no-danger
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
