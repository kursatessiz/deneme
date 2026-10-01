import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';

import type { INTER_FACE } from './interFaces';

/**
 * The only typeface of the app is Inter (the Perfect UI font, see
 * docs/TASARIM.md). React Native cannot synthesize weights for custom fonts,
 * so every weight is its own registered face. The keys must match INTER_FACE.
 */
export const INTER_FONT_ASSETS = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} as const satisfies Record<(typeof INTER_FACE)[keyof typeof INTER_FACE], unknown>;
