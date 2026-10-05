'use client';

import { useId } from 'react';
import { useElementSize } from './common';

/**
 * Small SVG charts drawn here (no chart library). They are measured with a
 * ResizeObserver and drawn at the real pixel size, so axis text keeps its
 * size when a card grows or shrinks. Colors are token classes (ui-chart-*)
 * and follow light and dark mode; every point carries a native tooltip.
 */

export interface ChartPoint {
  /** Axis label (already localized). */
  label: string;
  value: number;
  /** Tooltip text of the point (already localized). */
  tooltip: string;
}

/** Upper bound of the y axis: 1, 2 or 5 times a power of ten. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/** Indexes of the x labels to draw: first and last always, evenly spaced in between as width allows. */
export function labelIndexes(count: number, width: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const slots = Math.max(2, Math.min(count, Math.floor(width / 64)));
  const out = new Set<number>();
  for (let i = 0; i < slots; i += 1) out.add(Math.round((i * (count - 1)) / (slots - 1)));
  return [...out].sort((a, b) => a - b);
}

interface ChartProps {
  points: ChartPoint[];
  /** Formats a y axis tick. */
  formatTick: (value: number) => string;
  /** Accessible summary of the whole chart. */
  label: string;
  /** Fixed y axis maximum (1 for ratios); computed from the data when absent. */
  max?: number;
}

const PAD_TOP = 8;
const PAD_RIGHT = 8;
const PAD_BOTTOM = 24;

function frame(width: number, height: number, ticks: string[]) {
  const longest = ticks.reduce((m, s) => Math.max(m, s.length), 0);
  const left = Math.min(72, 8 + longest * 6.4);
  return { left, top: PAD_TOP, right: Math.max(left + 10, width - PAD_RIGHT), bottom: Math.max(PAD_TOP + 10, height - PAD_BOTTOM) };
}

function Axes({ box, ticks, max, values, labels }: { box: ReturnType<typeof frame>; ticks: string[]; max: number; values: number[]; labels: { x: number; text: string }[] }) {
  return (
    <g>
      {values.map((v, i) => {
        const y = box.bottom - (v / max) * (box.bottom - box.top);
        return (
          <g key={v}>
            <line className="ui-chart-grid" x1={box.left} x2={box.right} y1={y} y2={y} />
            <text x={box.left - 6} y={y} textAnchor="end" dominantBaseline="middle">
              {ticks[i]}
            </text>
          </g>
        );
      })}
      {labels.map((l) => (
        <text key={`${l.x}-${l.text}`} x={l.x} y={box.bottom + 17} textAnchor="middle">
          {l.text}
        </text>
      ))}
    </g>
  );
}

export function LineChart({ points, formatTick, label, max }: ChartProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const titleId = useId();
  const top = max ?? niceMax(Math.max(0, ...points.map((p) => p.value)));
  const tickValues = [0, top / 2, top];
  const ticks = tickValues.map(formatTick);
  const ready = size.width > 40 && size.height > 40 && points.length > 0;
  const box = frame(size.width, size.height, ticks);
  const step = points.length > 1 ? (box.right - box.left) / (points.length - 1) : 0;
  const xy = points.map((p, i) => ({
    x: points.length > 1 ? box.left + i * step : (box.left + box.right) / 2,
    y: box.bottom - (Math.min(p.value, top) / top) * (box.bottom - box.top),
  }));
  const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = xy.length > 0 ? `${line} L${xy[xy.length - 1].x.toFixed(1)},${box.bottom} L${xy[0].x.toFixed(1)},${box.bottom} Z` : '';
  const labels = labelIndexes(points.length, box.right - box.left).map((i) => ({ x: xy[i]?.x ?? 0, text: points[i]?.label ?? '' }));
  const showDots = step >= 10;

  return (
    <div ref={ref} className="h-full w-full min-h-0">
      {ready ? (
        <svg className="ui-chart" width={size.width} height={size.height} role="img" aria-labelledby={titleId}>
          <title id={titleId}>{label}</title>
          <Axes box={box} ticks={ticks} max={top} values={tickValues} labels={labels} />
          <path className="ui-chart-area" d={area} />
          <path className="ui-chart-line" d={line} />
          {xy.map((p, i) => (
            <circle key={points[i].label + i} className="ui-chart-dot" cx={p.x} cy={p.y} r={showDots ? 3 : 0.01}>
              <title>{points[i].tooltip}</title>
            </circle>
          ))}
        </svg>
      ) : null}
    </div>
  );
}

export function BarChart({ points, formatTick, label, max }: ChartProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const titleId = useId();
  const top = max ?? niceMax(Math.max(0, ...points.map((p) => p.value)));
  const tickValues = [0, top / 2, top];
  const ticks = tickValues.map(formatTick);
  const ready = size.width > 40 && size.height > 40 && points.length > 0;
  const box = frame(size.width, size.height, ticks);
  const slot = points.length > 0 ? (box.right - box.left) / points.length : 0;
  const barWidth = Math.max(2, Math.min(36, slot * 0.64));
  const labels = labelIndexes(points.length, box.right - box.left).map((i) => ({ x: box.left + slot * i + slot / 2, text: points[i]?.label ?? '' }));

  return (
    <div ref={ref} className="h-full w-full min-h-0">
      {ready ? (
        <svg className="ui-chart" width={size.width} height={size.height} role="img" aria-labelledby={titleId}>
          <title id={titleId}>{label}</title>
          <Axes box={box} ticks={ticks} max={top} values={tickValues} labels={labels} />
          {points.map((p, i) => {
            const h = (Math.min(p.value, top) / top) * (box.bottom - box.top);
            const x = box.left + slot * i + (slot - barWidth) / 2;
            return (
              <rect key={p.label + i} className="ui-chart-bar" x={x} y={box.bottom - h} width={barWidth} height={Math.max(h, p.value > 0 ? 1 : 0)} rx={Math.min(3, barWidth / 4)}>
                <title>{p.tooltip}</title>
              </rect>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}
