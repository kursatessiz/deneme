import React from 'react';
import { StyleSheet, Text as RNText } from 'react-native';
import type { TextProps } from 'react-native';

import { useFontsLoaded } from '../theme';
import { resolveFace } from './fontFace';

/**
 * Drop-in for react-native's Text that renders in Inter. React Native cannot
 * synthesize weights for a custom font, so the face is picked from the
 * style's fontWeight (or the family a screen set through useThemeFonts()).
 * System fonts are used until Inter has loaded.
 */
export function Text({ style, ...rest }: TextProps) {
  const loaded = useFontsLoaded();
  if (!loaded) return <RNText style={style} {...rest} />;
  const flat = StyleSheet.flatten(style) ?? {};
  const face = resolveFace(flat.fontFamily, flat.fontWeight);
  if (face === null) return <RNText style={style} {...rest} />;
  return <RNText style={[style, { fontFamily: face, fontWeight: undefined }]} {...rest} />;
}
