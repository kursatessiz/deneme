import { DASHBOARD_GRID, resolveWidgetPeriod } from '@platform/shared';
import type { DashboardColumnCount, DashboardLayoutItem, DashboardWidgetKey, DashboardWidgetSettings } from '@platform/shared';

/**
 * Pure helpers between the browser and the shared layout engine: pixel and
 * grid unit conversion for pointer drags and resizes, the keyboard map of
 * edit mode and the cache key of a card's data. Kept free of React and the
 * DOM so they are unit tested (grid-math.spec.ts).
 */

export interface GridMetrics {
  /** Width of the grid element in px. */
  width: number;
  columns: number;
  rowHeight: number;
  gap: number;
}

export function columnWidth(m: GridMetrics): number {
  return Math.max(1, (m.width - m.gap * (m.columns - 1)) / m.columns);
}

/** Top left corner of a cell in px, relative to the grid. */
export function cellOrigin(m: GridMetrics, x: number, y: number): { left: number; top: number } {
  return { left: x * (columnWidth(m) + m.gap), top: y * (m.rowHeight + m.gap) };
}

/** The cell a card's top left corner snaps to when dropped at (left, top) px, relative to the grid. */
export function pxToCell(m: GridMetrics, left: number, top: number, w: number): { x: number; y: number } {
  const x = Math.round(left / (columnWidth(m) + m.gap));
  const y = Math.round(top / (m.rowHeight + m.gap));
  return { x: Math.min(Math.max(x, 0), Math.max(0, m.columns - w)), y: Math.max(0, y) };
}

/** Grid units a card spans when its box is width x height px (rounded to the nearest unit, at least one). */
export function pxToSpan(m: GridMetrics, width: number, height: number): { w: number; h: number } {
  const w = Math.round((width + m.gap) / (columnWidth(m) + m.gap));
  const h = Math.round((height + m.gap) / (m.rowHeight + m.gap));
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** Size in px of a w x h card. */
export function spanToPx(m: GridMetrics, w: number, h: number): { width: number; height: number } {
  return { width: w * columnWidth(m) + (w - 1) * m.gap, height: h * m.rowHeight + (h - 1) * m.gap };
}

export function defaultMetrics(width: number, columns: DashboardColumnCount): GridMetrics {
  return { width, columns, rowHeight: DASHBOARD_GRID.rowHeight, gap: DASHBOARD_GRID.gap };
}

export type KeyboardAction =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'resize'; dw: number; dh: number }
  | { type: 'remove' }
  | { type: 'cancel' }
  | null;

/** Edit mode keys on a focused card: arrows move, Shift+arrows resize, Delete/Backspace remove, Escape cancel. */
export function keyboardAction(key: string, shiftKey: boolean): KeyboardAction {
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const delta = arrows[key];
  if (delta) return shiftKey ? { type: 'resize', dw: delta[0], dh: delta[1] } : { type: 'move', dx: delta[0], dy: delta[1] };
  if (key === 'Delete' || key === 'Backspace') return { type: 'remove' };
  if (key === 'Escape') return { type: 'cancel' };
  return null;
}

/** Identity of a card's figures: the same card with the same period under the same branch filter shares one result. */
export function widgetDataKey(widget: DashboardWidgetKey, settings: DashboardWidgetSettings | undefined, branchId: string | null): string {
  return `${branchId ?? '*'}|${widget}|${resolveWidgetPeriod(widget, settings) ?? ''}`;
}

/** Items in a stable order for the data request: one entry per distinct data key. */
export function distinctDataRequests(
  items: readonly DashboardLayoutItem[],
  branchId: string | null,
  skip: (widget: DashboardWidgetKey) => boolean,
): { key: string; item: DashboardLayoutItem }[] {
  const seen = new Set<string>();
  const out: { key: string; item: DashboardLayoutItem }[] = [];
  for (const item of items) {
    if (skip(item.widget)) continue;
    const key = widgetDataKey(item.widget, item.settings, branchId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, item });
  }
  return out;
}
