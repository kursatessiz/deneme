import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';

import { chartGeometry, labelIndexes } from '../lib/dashboardChart';
import type { ChartBox } from '../lib/dashboardChart';
import { spacing, typography, useThemeColors } from '../theme';

export interface TrendPoint {
  /** Axis label (already localized). */
  label: string;
  value: number;
}

export interface TrendChartProps {
  points: readonly TrendPoint[];
  /** Formats a y axis tick (already locale aware). */
  formatTick: (value: number) => string;
  /** Accessible summary of the whole chart. */
  accessibilityLabel: string;
  /** Fixed y axis maximum (1 for ratios); computed from the data when absent. */
  max?: number;
  height?: number;
}

const PAD_TOP = spacing[2];
const PAD_RIGHT = spacing[2];
const PAD_BOTTOM = spacing[5];
const TICK_CHAR_WIDTH = 6.4;

/**
 * Line and area chart drawn with react-native-svg. Measured once from its
 * container so axis text keeps its size; colors come from the theme.
 */
export function TrendChart({ points, formatTick, accessibilityLabel, max, height = 140 }: TrendChartProps) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);

  const values = points.map((p) => p.value);
  const top = chartGeometry(values, { left: 0, top: 0, right: 1, bottom: 1 }, max).max;
  const ticks = [0, top / 2, top].map((v) => ({ value: v, text: formatTick(v) }));
  const longest = ticks.reduce((m, tick) => Math.max(m, tick.text.length), 0);
  const left = Math.min(72, spacing[2] + longest * TICK_CHAR_WIDTH);
  const box: ChartBox = { left, top: PAD_TOP, right: Math.max(left + 10, width - PAD_RIGHT), bottom: Math.max(PAD_TOP + 10, height - PAD_BOTTOM) };
  const geometry = chartGeometry(values, box, top);
  const labels = labelIndexes(points.length, box.right - box.left).map((i) => ({ x: geometry.points[i]?.x ?? 0, text: points[i]?.label ?? '' }));
  const yOf = (value: number) => box.bottom - (value / top) * (box.bottom - box.top);

  return (
    <View
      style={[styles.wrap, { height }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {width > 40 && points.length > 0 ? (
        <Svg width={width} height={height}>
          {ticks.map((tick) => (
            <React.Fragment key={tick.value}>
              <Line x1={box.left} x2={box.right} y1={yOf(tick.value)} y2={yOf(tick.value)} stroke={colors.border} strokeWidth={1} />
              <SvgText x={box.left - spacing[1]} y={yOf(tick.value) + 4} fontSize={typography.size.xs - 1} fill={colors.textMuted} textAnchor="end">
                {tick.text}
              </SvgText>
            </React.Fragment>
          ))}
          {labels.map((l, i) => (
            <SvgText
              key={`${l.x}-${l.text}`}
              x={l.x}
              y={box.bottom + spacing[4]}
              fontSize={typography.size.xs - 1}
              fill={colors.textMuted}
              textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}
            >
              {l.text}
            </SvgText>
          ))}
          <Path d={geometry.area} fill={colors.primarySubtleBg} />
          <Path d={geometry.line} fill="none" stroke={colors.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
});
