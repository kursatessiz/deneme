import { Archivo_700Bold, Archivo_800ExtraBold } from '@expo-google-fonts/archivo';
import { Figtree_400Regular, Figtree_600SemiBold } from '@expo-google-fonts/figtree';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { IBMPlexSans_400Regular, IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans';
import { Manrope_400Regular, Manrope_600SemiBold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { NunitoSans_400Regular, NunitoSans_700Bold } from '@expo-google-fonts/nunito-sans';
import { SchibstedGrotesk_600SemiBold, SchibstedGrotesk_800ExtraBold } from '@expo-google-fonts/schibsted-grotesk';
import type { THEME_FAMILIES, ThemeFamilyKey } from '@platform/shared';

type FamilyFonts<K extends ThemeFamilyKey> = (typeof THEME_FAMILIES)[K]['fonts'];
type NativeNames<F extends { native: { regular: string; strong: string } }> = F['native']['regular'] | F['native']['strong'];
type NativeFontName = {
  [K in ThemeFamilyKey]: NativeNames<FamilyFonts<K>['display']> | NativeNames<FamilyFonts<K>['body']>;
}[ThemeFamilyKey];

/**
 * Every face used by the theme families. Keys must match
 * THEME_FAMILIES[*].fonts.*.native in @platform/shared.
 */
export const THEME_FONT_ASSETS = {
  SchibstedGrotesk_600SemiBold,
  SchibstedGrotesk_800ExtraBold,
  Figtree_400Regular,
  Figtree_600SemiBold,
  Fraunces_600SemiBold,
  NunitoSans_400Regular,
  NunitoSans_700Bold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  IBMPlexSans_400Regular,
  IBMPlexSans_600SemiBold,
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_800ExtraBold,
} as const satisfies Record<NativeFontName, unknown>;
