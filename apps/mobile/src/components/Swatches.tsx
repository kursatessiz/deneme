import React from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '../theme';

/** A few flat color chips used as a preview; not a gradient slot. */
export function Swatches({ colors, size = 18, radius = 6 }: { colors: readonly string[]; size?: number; radius?: number }) {
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {colors.map((color, i) => (
        <View key={`${color}-${i}`} style={{ width: size, height: size, borderRadius: radius, backgroundColor: color }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing[1] },
});
