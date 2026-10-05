import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { Text } from '../components/Text';
import type { Rect } from '../lib/dashboardBoard';
import { TOUCH_TARGET, borderWidth, radii, spacing, typography, useTheme, useThemeFonts } from '../theme';

const ICON_SIZE = 28;
/** Height of the target; the bottom edge sits one spacing step above the screen's safe edge. */
export const TRASH_HEIGHT = TOUCH_TARGET + spacing[8];

/** Trash can drawn with react-native-svg (the app has no icon font). */
export function TrashIcon({ color, size = ICON_SIZE }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 6h18" />
      <Path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <Line x1="10" y1="11" x2="10" y2="17" />
      <Line x1="14" y1="11" x2="14" y2="17" />
    </Svg>
  );
}

export interface TrashTargetProps {
  /** True while the dragged card is over the target: it turns to the error role color. */
  active: boolean;
  label: string;
  /** Window rect of the target, reported when it is laid out. */
  onMeasure: (rect: Rect) => void;
}

/**
 * The drop target of the long-press-to-remove gesture, bottom center of
 * the screen. Pure display: the screen hit-tests the finger against the
 * rect it reports. Hidden from screen readers, which use the card's
 * "remove" action instead.
 */
export function TrashTarget({ active, label, onMeasure }: TrashTargetProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const error = theme.roles.error;
  const c = theme.colors;
  const ref = useRef<View | null>(null);

  const measure = () => {
    ref.current?.measureInWindow((x, y, width, height) => onMeasure({ x, y, width, height }));
  };

  return (
    <View pointerEvents="none" style={styles.anchor} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View
        ref={ref}
        onLayout={measure}
        style={[styles.target, { borderRadius: radii.md, borderColor: active ? error : c.border, backgroundColor: active ? error : c.surface }]}
      >
        <TrashIcon color={active ? c.onPrimary : error} />
        <Text style={[styles.label, fonts.bodyMedium, { color: active ? c.onPrimary : c.textPrimary }]}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, right: 0, bottom: spacing[6], alignItems: 'center' },
  target: {
    height: TRASH_HEIGHT,
    minWidth: 180,
    paddingHorizontal: spacing[5],
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    borderWidth: borderWidth,
  },
  label: { fontSize: typography.size.xs },
});
