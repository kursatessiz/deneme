import React from 'react';
import { StyleSheet, TextInput as RNTextInput } from 'react-native';
import type { TextInputProps } from 'react-native';

import { useFontsLoaded } from '../theme';
import { resolveFace } from './fontFace';

/** Drop-in for react-native's TextInput that renders in Inter (see Text). */
export function TextInput({ style, ...rest }: TextInputProps) {
  const loaded = useFontsLoaded();
  if (!loaded) return <RNTextInput style={style} {...rest} />;
  const flat = StyleSheet.flatten(style) ?? {};
  const face = resolveFace(flat.fontFamily, flat.fontWeight);
  if (face === null) return <RNTextInput style={style} {...rest} />;
  return <RNTextInput style={[style, { fontFamily: face, fontWeight: undefined }]} {...rest} />;
}
