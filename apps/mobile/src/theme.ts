import { useColorScheme } from 'react-native';

import { palette, radii, semanticColors, spacing, typography } from '@platform/shared';

export type AppColorScheme = 'light' | 'dark';

/** Semantic colors for the active OS color scheme. Never hardcode colors. */
export function useThemeColors() {
  const scheme = useColorScheme();
  return semanticColors[scheme === 'dark' ? 'dark' : 'light'];
}

export { palette, radii, spacing, typography };
