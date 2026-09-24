import { palette, semanticColors, radii } from '@platform/shared';

/**
 * The super-admin panel is platform chrome, not a tenant: CLAUDE.md rule 10
 * says nothing outside the four tenant theme families/gradients gets
 * themed, so this reads the same neutral, non-gradient design tokens
 * (packages/shared/src/design) directly instead of inventing web-only
 * colors, and never renders a gradient.
 */
export function AdminTheme() {
  const css = `
    .admin-root {
      --color-background: ${semanticColors.light.background};
      --color-surface: ${semanticColors.light.surface};
      --color-surface-muted: ${semanticColors.light.surfaceMuted};
      --color-border: ${semanticColors.light.border};
      --color-text-primary: ${semanticColors.light.textPrimary};
      --color-text-secondary: ${semanticColors.light.textSecondary};
      --color-text-muted: ${semanticColors.light.textMuted};
      --color-primary: ${palette.ink[900]};
      --color-on-primary: ${palette.white};
      --color-danger: ${palette.danger};
      --color-success: ${palette.success};
      --color-warning: ${palette.warning};
      --radius-card: ${radii.lg}px;
      --radius-button: ${radii.md}px;
      --radius-chip: ${radii.full}px;
      --radius-input: ${radii.sm}px;
      background-color: var(--color-background);
      color: var(--color-text-primary);
      min-height: 100vh;
    }
    @media (prefers-color-scheme: dark) {
      .admin-root {
        --color-background: ${semanticColors.dark.background};
        --color-surface: ${semanticColors.dark.surface};
        --color-surface-muted: ${semanticColors.dark.surfaceMuted};
        --color-border: ${semanticColors.dark.border};
        --color-text-primary: ${semanticColors.dark.textPrimary};
        --color-text-secondary: ${semanticColors.dark.textSecondary};
        --color-text-muted: ${semanticColors.dark.textMuted};
        --color-primary: ${palette.ink[100]};
        --color-on-primary: ${palette.ink[950]};
      }
    }
  `;
  // eslint-disable-next-line react/no-danger
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
