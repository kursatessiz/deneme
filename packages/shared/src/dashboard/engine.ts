import { DASHBOARD_GRID } from './grid';
import type { DashboardColumnCount } from './grid';
import { getDashboardWidget } from './widgets';
import type { DashboardWidgetKey, DashboardWidgetSettings } from './widgets';
import type { DashboardLayoutItem } from './layout';

/**
 * Pure layout engine of the overview grid. Every function returns new
 * arrays and items and never mutates its input, so the web client can keep
 * the last committed layout for rollback and preview a drag on a copy.
 *
 * Compaction follows the react-grid-layout model with vertical gravity:
 * items are visited in reading order (y, then x) and each one rises until it
 * touches an item above it, then sinks below anything it still overlaps. The
 * result never overlaps and keeps the reading order of the input.
 */

const COLUMNS = DASHBOARD_GRID.columns;

function clampInt(value: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(Math.max(n, min), max);
}

/** True when two items share at least one cell. */
export function itemsCollide(a: Pick<DashboardLayoutItem, 'x' | 'y' | 'w' | 'h'>, b: Pick<DashboardLayoutItem, 'x' | 'y' | 'w' | 'h'>): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Index of the bottom row edge (first free row under every item). */
export function layoutBottom(items: readonly DashboardLayoutItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

/** Size limits of a widget in a grid of `columns` columns (widths never exceed the grid). */
export function widgetLimits(widget: DashboardWidgetKey, columns: number = COLUMNS) {
  const { size } = getDashboardWidget(widget);
  const maxW = Math.min(size.maxW, columns);
  const minW = Math.min(size.minW, maxW);
  return { minW, maxW, minH: size.minH, maxH: size.maxH };
}

/**
 * Brings one item inside its widget's size limits and inside the grid:
 * width and height are clamped, then x is pulled left so the item fits, y is
 * kept non-negative. Works for any column count (1, 6, 12).
 */
export function clampToWidget(item: DashboardLayoutItem, columns: number = COLUMNS): DashboardLayoutItem {
  const limits = widgetLimits(item.widget, columns);
  const w = clampInt(item.w, limits.minW, limits.maxW);
  const h = clampInt(item.h, limits.minH, limits.maxH);
  const x = clampInt(item.x, 0, columns - w);
  const y = clampInt(item.y, 0, DASHBOARD_GRID.maxY);
  return { ...item, x, y, w, h };
}

function sortForCompaction(items: readonly DashboardLayoutItem[], priorityId?: string): DashboardLayoutItem[] {
  return [...items].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (priorityId) {
      if (a.id === priorityId) return -1;
      if (b.id === priorityId) return 1;
    }
    return a.x - b.x;
  });
}

/**
 * Vertical gravity without overlaps. `priorityId` wins ties on the same row,
 * which is how a moved or resized item keeps its target row and pushes the
 * others down. The output keeps the input order of the array.
 */
export function compact(items: readonly DashboardLayoutItem[], priorityId?: string): DashboardLayoutItem[] {
  const placed: DashboardLayoutItem[] = [];
  const byId = new Map<string, DashboardLayoutItem>();
  for (const original of sortForCompaction(items, priorityId)) {
    const item = { ...original };
    item.y = Math.min(item.y, layoutBottom(placed));
    while (item.y > 0 && !placed.some((p) => itemsCollide(p, { ...item, y: item.y - 1 }))) item.y -= 1;
    while (placed.some((p) => itemsCollide(p, item))) item.y += 1;
    placed.push(item);
    byId.set(item.id, item);
  }
  return items.map((item) => byId.get(item.id) ?? item);
}

/** Clamps every item to its widget and the grid, then compacts. What the API stores. */
export function normalizeLayout(items: readonly DashboardLayoutItem[], columns: number = COLUMNS): DashboardLayoutItem[] {
  return compact(items.map((item) => clampToWidget(item, columns)));
}

/**
 * Puts item `id` at (x, y) (clamped into the grid) and compacts with that
 * item taking priority on its row: others it lands on move down.
 */
export function moveItem(items: readonly DashboardLayoutItem[], id: string, x: number, y: number, columns: number = COLUMNS): DashboardLayoutItem[] {
  const next = items.map((item) => (item.id === id ? clampToWidget({ ...item, x, y }, columns) : item));
  return compact(next, id);
}

/**
 * Resizes item `id` to w x h, clamped to its widget's limits and to the
 * columns right of its x; the items it now covers are pushed down.
 */
export function resizeItem(items: readonly DashboardLayoutItem[], id: string, w: number, h: number, columns: number = COLUMNS): DashboardLayoutItem[] {
  const next = items.map((item) => {
    if (item.id !== id) return item;
    const limits = widgetLimits(item.widget, columns);
    const maxW = Math.max(limits.minW, Math.min(limits.maxW, columns - item.x));
    return { ...item, w: clampInt(w, limits.minW, maxW), h: clampInt(h, limits.minH, limits.maxH) };
  });
  return compact(
    next.map((item) => (item.id === id ? clampToWidget(item, columns) : item)),
    id,
  );
}

/** What a resize request would produce for one item, and whether a limit stopped it. */
export function resizeLimitHit(
  item: DashboardLayoutItem,
  w: number,
  h: number,
  columns: number = COLUMNS,
): { w: number; h: number; atMinW: boolean; atMaxW: boolean; atMinH: boolean; atMaxH: boolean } {
  const limits = widgetLimits(item.widget, columns);
  const maxW = Math.max(limits.minW, Math.min(limits.maxW, columns - item.x));
  const cw = clampInt(w, limits.minW, maxW);
  const ch = clampInt(h, limits.minH, limits.maxH);
  return { w: cw, h: ch, atMinW: w <= limits.minW, atMaxW: w >= maxW, atMinH: h <= limits.minH, atMaxH: h >= limits.maxH };
}

/**
 * One keyboard step: moves item `id` by (dx, dy) grid units. Gravity can
 * undo a one row move (the item would fall back), so the step grows until
 * the item's position actually changes or the edge of the board is reached.
 * Returns the input unchanged when the item cannot move that way.
 */
export function nudgeItem(items: readonly DashboardLayoutItem[], id: string, dx: number, dy: number, columns: number = COLUMNS): DashboardLayoutItem[] {
  const current = items.find((item) => item.id === id);
  if (!current || (dx === 0 && dy === 0)) return [...items];
  const limit = dy > 0 ? layoutBottom(items) + 1 : Math.max(current.y, columns);
  for (let step = 1; step <= Math.max(limit, 1); step += 1) {
    const x = current.x + dx * step;
    const y = current.y + dy * step;
    if (x < 0 || x + current.w > columns || y < 0) break;
    const next = moveItem(items, id, x, y, columns);
    const moved = next.find((item) => item.id === id);
    if (moved && (moved.x !== current.x || moved.y !== current.y)) return next;
    if (dx !== 0) break;
  }
  return [...items];
}

/** First free slot (top to bottom, left to right) for a w x h box. */
export function findFirstFit(items: readonly DashboardLayoutItem[], w: number, h: number, columns: number = COLUMNS, fromY = 0): { x: number; y: number } {
  const width = Math.min(w, columns);
  const bottom = layoutBottom(items);
  for (let y = fromY; y <= bottom; y += 1) {
    for (let x = 0; x + width <= columns; x += 1) {
      const box = { x, y, w: width, h };
      if (!items.some((item) => itemsCollide(item, box))) return { x, y };
    }
  }
  return { x: 0, y: Math.max(bottom, fromY) };
}

/** A new card of `widget` at its default size in the first slot it fits. */
export function placeNewItem(
  items: readonly DashboardLayoutItem[],
  widget: DashboardWidgetKey,
  id: string,
  settings?: DashboardWidgetSettings,
  columns: number = COLUMNS,
): DashboardLayoutItem {
  const { size } = getDashboardWidget(widget);
  const w = Math.min(size.defaultW, columns);
  const { x, y } = findFirstFit(items, w, size.defaultH, columns);
  const item: DashboardLayoutItem = { id, widget, x, y, w, h: size.defaultH };
  return settings ? { ...item, settings } : item;
}

/** Items in reading order: by row, then column. */
export function readingOrder(items: readonly DashboardLayoutItem[]): DashboardLayoutItem[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * The arrangement a narrower screen shows. 12 returns the layout as it is;
 * 6 halves widths (never under half the widget's minimum, never over 6) and
 * packs the cards in reading order into the first slot at or below the
 * previous card's row; 1 stacks them full width in reading order. Heights
 * are kept. Derived only, never stored.
 */
export function scaleForColumns(items: readonly DashboardLayoutItem[], columns: DashboardColumnCount): DashboardLayoutItem[] {
  if (columns === COLUMNS) return items.map((item) => ({ ...item }));
  const ordered = readingOrder(items);
  if (columns === 1) {
    let y = 0;
    return ordered.map((item) => {
      const next = { ...item, x: 0, y, w: 1 };
      y += item.h;
      return next;
    });
  }
  const placed: DashboardLayoutItem[] = [];
  let rowFloor = 0;
  for (const item of ordered) {
    const { size } = getDashboardWidget(item.widget);
    const w = clampInt(Math.round(item.w / 2), Math.ceil(size.minW / 2), columns);
    const { x, y } = findFirstFit(placed, w, item.h, columns, rowFloor);
    placed.push({ ...item, x, y, w });
    rowFloor = y;
  }
  return placed;
}

/**
 * Moves an item one place earlier or later in reading order (the single
 * column board's reorder): the two items swap their top left corners and
 * the board is compacted. Used by the move menu and the keyboard on narrow
 * screens, where positions in the wide grid are not visible.
 */
export function reorderItem(items: readonly DashboardLayoutItem[], id: string, direction: -1 | 1): DashboardLayoutItem[] {
  const ordered = readingOrder(items);
  const index = ordered.findIndex((item) => item.id === id);
  const otherIndex = index + direction;
  if (index < 0 || otherIndex < 0 || otherIndex >= ordered.length) return [...items];
  const a = ordered[index];
  const b = ordered[otherIndex];
  const swapped = items.map((item) => {
    if (item.id === a.id) return clampToWidget({ ...item, x: b.x, y: b.y });
    if (item.id === b.id) return clampToWidget({ ...item, x: a.x, y: a.y });
    return item;
  });
  // The moved item wins its new row; ties on the row resolve in its favour.
  const result = compact(swapped, a.id);
  const before = readingOrder(result).findIndex((item) => item.id === id);
  if (before === index) {
    // Different widths can make the swap fall back into place; fall back to a row swap.
    const forced = items.map((item) => {
      if (item.id === a.id) return { ...item, y: direction < 0 ? Math.max(0, b.y) : b.y + b.h };
      return item;
    });
    return compact(forced, a.id);
  }
  return result;
}

/** Removes item `id` and compacts what is left. */
export function removeItem(items: readonly DashboardLayoutItem[], id: string): DashboardLayoutItem[] {
  return compact(items.filter((item) => item.id !== id));
}

/**
 * Puts a previously removed item back at its stored position (undo). The
 * restored item takes priority on its row, so cards that moved into its
 * place in the meantime are pushed down instead of overlapping it.
 */
export function restoreItem(items: readonly DashboardLayoutItem[], item: DashboardLayoutItem): DashboardLayoutItem[] {
  return compact([...items.filter((other) => other.id !== item.id), item], item.id);
}

/** Same cards at the same positions and sizes with the same settings. */
export function layoutsEqual(a: readonly DashboardLayoutItem[], b: readonly DashboardLayoutItem[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((item) => [item.id, item]));
  return a.every((item) => {
    const other = byId.get(item.id);
    return (
      !!other &&
      other.widget === item.widget &&
      other.x === item.x &&
      other.y === item.y &&
      other.w === item.w &&
      other.h === item.h &&
      (other.settings?.period ?? null) === (item.settings?.period ?? null)
    );
  });
}
