/**
 * Geometry of the overview board's small line/area charts, kept free of
 * react-native so it can be unit-tested. The component only draws what
 * these functions return.
 */

export interface ChartBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ChartGeometry {
  /** Upper bound of the y axis. */
  max: number;
  points: { x: number; y: number }[];
  /** SVG path of the line; empty without points. */
  line: string;
  /** SVG path of the filled area under the line; empty without points. */
  area: string;
}

/** Upper bound of the y axis: 1, 2 or 5 times a power of ten. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/** Plots `values` inside `box`; a single value is centred. `max` fixes the y axis (1 for ratios). */
export function chartGeometry(values: readonly number[], box: ChartBox, max?: number): ChartGeometry {
  const top = max ?? niceMax(Math.max(0, ...values));
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const points = values.map((value, i) => ({
    x: values.length > 1 ? box.left + (i * width) / (values.length - 1) : box.left + width / 2,
    y: box.bottom - (Math.min(Math.max(value, 0), top) / top) * height,
  }));
  if (points.length === 0) return { max: top, points, line: '', area: '' };
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const area = `${line} L${last.x.toFixed(1)},${box.bottom} L${points[0].x.toFixed(1)},${box.bottom} Z`;
  return { max: top, points, line, area };
}

/** Indexes of the x labels to draw: first and last, plus evenly spaced ones while `width` allows. */
export function labelIndexes(count: number, width: number, perLabel = 64): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const slots = Math.max(2, Math.min(count, Math.floor(width / perLabel)));
  const out = new Set<number>();
  for (let i = 0; i < slots; i += 1) out.add(Math.round((i * (count - 1)) / (slots - 1)));
  return [...out].sort((a, b) => a - b);
}
