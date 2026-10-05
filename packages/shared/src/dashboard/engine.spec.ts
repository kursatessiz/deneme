import {
  clampToWidget,
  compact,
  findFirstFit,
  itemsCollide,
  layoutsEqual,
  moveItem,
  normalizeLayout,
  nudgeItem,
  placeNewItem,
  readingOrder,
  removeItem,
  reorderItem,
  resizeItem,
  resizeLimitHit,
  restoreItem,
  scaleForColumns,
} from './engine';
import { DASHBOARD_WIDGETS, getDashboardWidget } from './widgets';
import type { DashboardWidgetKey } from './widgets';
import type { DashboardLayoutItem } from './layout';

let counter = 0;
function id(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

function item(widget: DashboardWidgetKey, x: number, y: number, w: number, h: number, itemId = id()): DashboardLayoutItem {
  return { id: itemId, widget, x, y, w, h };
}

function noOverlaps(items: readonly DashboardLayoutItem[]): boolean {
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (itemsCollide(items[i], items[j])) return false;
    }
  }
  return true;
}

function within(items: readonly DashboardLayoutItem[], columns = 12): boolean {
  return items.every((it) => it.x >= 0 && it.y >= 0 && it.x + it.w <= columns);
}

function find(items: readonly DashboardLayoutItem[], itemId: string): DashboardLayoutItem {
  const found = items.find((it) => it.id === itemId);
  if (!found) throw new Error(`missing ${itemId}`);
  return found;
}

describe('itemsCollide', () => {
  it('detects shared cells and ignores touching edges', () => {
    expect(itemsCollide({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    expect(itemsCollide({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false);
    expect(itemsCollide({ x: 0, y: 0, w: 2, h: 2 }, { x: 0, y: 2, w: 2, h: 2 })).toBe(false);
  });
});

describe('clampToWidget', () => {
  it('clamps every catalogue widget into its min and max', () => {
    for (const widget of DASHBOARD_WIDGETS) {
      const tiny = clampToWidget(item(widget.key, 0, 0, 1, 1));
      expect(tiny.w).toBe(widget.size.minW);
      expect(tiny.h).toBe(widget.size.minH);
      const huge = clampToWidget(item(widget.key, 0, 0, 40, 40));
      expect(huge.w).toBe(widget.size.maxW);
      expect(huge.h).toBe(widget.size.maxH);
    }
  });

  it('pulls x left so the item stays inside the grid and keeps y non-negative', () => {
    const clamped = clampToWidget(item('revenue', 11, -3, 4, 2));
    expect(clamped).toMatchObject({ x: 8, y: 0, w: 4 });
  });

  it('never makes a widget wider than the grid', () => {
    expect(clampToWidget(item('weekCalendar', 0, 0, 12, 5), 6).w).toBe(6);
    expect(clampToWidget(item('weekCalendar', 0, 0, 12, 5), 1).w).toBe(1);
  });

  it('rounds fractional input', () => {
    expect(clampToWidget(item('revenue', 1.6, 2.2, 2.6, 2.4))).toMatchObject({ x: 2, y: 2, w: 3, h: 2 });
  });
});

describe('compact', () => {
  it('lifts items to the top with vertical gravity', () => {
    const a = item('revenue', 0, 5, 3, 2);
    const result = compact([a]);
    expect(result[0].y).toBe(0);
  });

  it('stacks overlapping items without overlaps and keeps the reading order', () => {
    const a = item('revenue', 0, 0, 3, 2);
    const b = item('activeMembers', 1, 0, 3, 2);
    const c = item('occupancy', 0, 1, 3, 2);
    const result = compact([a, b, c]);
    expect(noOverlaps(result)).toBe(true);
    expect(find(result, a.id).y).toBe(0);
    expect(find(result, b.id).y).toBe(2);
    expect(find(result, c.id).y).toBe(4);
  });

  it('does not let an item jump over a blocker into a hole above it', () => {
    const blocker = item('todaySchedule', 0, 2, 6, 4);
    const hole = item('revenue', 6, 0, 3, 2);
    const below = item('activeMembers', 0, 9, 3, 2);
    const result = compact([blocker, hole, below]);
    expect(find(result, blocker.id).y).toBe(0);
    expect(find(result, below.id).y).toBe(4);
  });

  it('returns items in the input order', () => {
    const a = item('revenue', 0, 4, 3, 2);
    const b = item('activeMembers', 0, 0, 3, 2);
    expect(compact([a, b]).map((it) => it.id)).toEqual([a.id, b.id]);
  });

  it('does not mutate its input', () => {
    const a = item('revenue', 0, 4, 3, 2);
    compact([a]);
    expect(a.y).toBe(4);
  });
});

describe('moveItem', () => {
  it('moves an item sideways into free space', () => {
    const a = item('revenue', 0, 0, 3, 2);
    const result = moveItem([a], a.id, 6, 0);
    expect(find(result, a.id)).toMatchObject({ x: 6, y: 0 });
  });

  it('pushes the item it lands on down (the moved item wins the row)', () => {
    const a = item('revenue', 0, 0, 3, 2);
    const b = item('activeMembers', 3, 0, 3, 2);
    const result = moveItem([a, b], a.id, 3, 0);
    expect(find(result, a.id)).toMatchObject({ x: 3, y: 0 });
    expect(find(result, b.id)).toMatchObject({ x: 3, y: 2 });
    expect(noOverlaps(result)).toBe(true);
  });

  it('swaps vertically once the target row passes the other item', () => {
    const a = item('revenue', 0, 0, 3, 2);
    const b = item('activeMembers', 0, 2, 3, 2);
    const result = moveItem([a, b], a.id, 0, 3);
    expect(find(result, b.id).y).toBe(0);
    expect(find(result, a.id).y).toBe(2);
  });

  it('clamps targets outside the grid', () => {
    const a = item('revenue', 0, 0, 3, 2);
    const result = moveItem([a], a.id, 20, -4);
    expect(find(result, a.id)).toMatchObject({ x: 9, y: 0 });
  });

  it('keeps every board free of overlaps for random moves', () => {
    const keys: DashboardWidgetKey[] = ['revenue', 'todaySchedule', 'revenueTrend', 'branches', 'weekCalendar', 'activeMembers', 'lowStock'];
    let board = normalizeLayout(keys.map((key, i) => item(key, (i * 3) % 12, i * 2, 4, 4)));
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 200; i += 1) {
      const target = board[rand(board.length)];
      board = moveItem(board, target.id, rand(12), rand(20));
      expect(noOverlaps(board)).toBe(true);
      expect(within(board)).toBe(true);
    }
  });
});

describe('resizeItem', () => {
  it('grows an item and pushes covered items down', () => {
    const a = item('revenueTrend', 0, 0, 6, 4);
    const b = item('revenue', 6, 0, 3, 2);
    const result = resizeItem([a, b], a.id, 9, 4);
    expect(find(result, a.id)).toMatchObject({ w: 9, h: 4 });
    expect(find(result, b.id).y).toBe(4);
    expect(noOverlaps(result)).toBe(true);
  });

  it('stops at the widget maximum and minimum', () => {
    const kpi = item('revenue', 0, 0, 3, 2);
    expect(find(resizeItem([kpi], kpi.id, 9, 9), kpi.id)).toMatchObject({ w: 4, h: 3 });
    expect(find(resizeItem([kpi], kpi.id, 1, 1), kpi.id)).toMatchObject({ w: 2, h: 2 });
    const calendar = item('weekCalendar', 0, 0, 8, 5);
    expect(find(resizeItem([calendar], calendar.id, 2, 2), calendar.id)).toMatchObject({ w: 6, h: 4 });
  });

  it('cannot grow past the right edge of the grid', () => {
    const chart = item('revenueTrend', 8, 0, 4, 3);
    expect(find(resizeItem([chart], chart.id, 12, 3), chart.id).w).toBe(4);
  });

  it('reports which limit a resize hit', () => {
    const kpi = item('revenue', 0, 0, 3, 2);
    expect(resizeLimitHit(kpi, 5, 2)).toMatchObject({ w: 4, atMaxW: true, atMinH: true });
    expect(resizeLimitHit(kpi, 3, 3)).toMatchObject({ atMaxW: false, atMaxH: true });
    expect(resizeLimitHit(item('revenue', 10, 0, 2, 2), 3, 2)).toMatchObject({ w: 2, atMaxW: true });
  });
});

describe('nudgeItem', () => {
  it('moves one column per step', () => {
    const a = item('revenue', 0, 0, 3, 2);
    expect(find(nudgeItem([a], a.id, 1, 0), a.id).x).toBe(1);
    expect(find(nudgeItem([a], a.id, -1, 0), a.id).x).toBe(0);
  });

  it('moves past the item below in one press even though gravity would undo one row', () => {
    const a = item('revenue', 0, 0, 3, 2);
    const b = item('activeMembers', 0, 2, 3, 2);
    const result = nudgeItem([a, b], a.id, 0, 1);
    expect(find(result, a.id).y).toBe(2);
    expect(find(result, b.id).y).toBe(0);
  });

  it('moves up over the item above', () => {
    const a = item('revenue', 0, 0, 3, 2);
    const b = item('activeMembers', 0, 2, 3, 2);
    const result = nudgeItem([a, b], b.id, 0, -1);
    expect(find(result, b.id).y).toBe(0);
    expect(find(result, a.id).y).toBe(2);
  });

  it('leaves the board unchanged at an edge', () => {
    const a = item('revenue', 9, 0, 3, 2);
    expect(nudgeItem([a], a.id, 1, 0)).toEqual([a]);
    expect(nudgeItem([a], a.id, 0, -1)).toEqual([a]);
    expect(nudgeItem([a], a.id, 0, 1)).toEqual([a]);
  });
});

describe('placeNewItem and findFirstFit', () => {
  it('uses the first free slot at the default size', () => {
    const a = item('revenue', 0, 0, 3, 2);
    const placed = placeNewItem([a], 'activeMembers', id());
    expect(placed).toMatchObject({ x: 3, y: 0, w: 3, h: 2 });
  });

  it('goes under the board when no slot is free', () => {
    const full = item('quickActions', 0, 0, 12, 2);
    expect(placeNewItem([full], 'revenueTrend', id())).toMatchObject({ x: 0, y: 2, w: 6, h: 4 });
  });

  it('keeps settings', () => {
    expect(placeNewItem([], 'revenue', id(), { period: 'today' }).settings).toEqual({ period: 'today' });
  });

  it('finds holes between items', () => {
    const a = item('revenue', 0, 0, 3, 2);
    const b = item('revenue', 6, 0, 3, 2);
    expect(findFirstFit([a, b], 3, 2)).toEqual({ x: 3, y: 0 });
  });
});

describe('scaleForColumns', () => {
  const board = normalizeLayout([
    item('quickActions', 0, 0, 12, 2),
    item('revenue', 0, 2, 3, 2),
    item('activeMembers', 3, 2, 3, 2),
    item('occupancy', 6, 2, 3, 2),
    item('todaySessions', 9, 2, 3, 2),
    item('todaySchedule', 0, 4, 8, 5),
    item('branches', 8, 4, 4, 5),
  ]);

  it('returns a copy for 12 columns', () => {
    const scaled = scaleForColumns(board, 12);
    expect(scaled).toEqual(board);
    expect(scaled[0]).not.toBe(board[0]);
  });

  it('packs into 6 columns without overlaps and keeps reading order', () => {
    const scaled = scaleForColumns(board, 6);
    expect(noOverlaps(scaled)).toBe(true);
    expect(within(scaled, 6)).toBe(true);
    expect(readingOrder(scaled).map((it) => it.widget)).toEqual(readingOrder(board).map((it) => it.widget));
    expect(find(scaled, board[0].id).w).toBe(6);
    expect(find(scaled, board[1].id).w).toBe(2);
    expect(find(scaled, board[5].id).w).toBe(4);
  });

  it('never goes under half the widget minimum', () => {
    const scaled = scaleForColumns([item('weekCalendar', 0, 0, 6, 4)], 6);
    expect(scaled[0].w).toBe(3);
  });

  it('stacks in one column in reading order', () => {
    const scaled = scaleForColumns(board, 1);
    expect(scaled.every((it) => it.x === 0 && it.w === 1)).toBe(true);
    expect(noOverlaps(scaled)).toBe(true);
    expect(scaled.map((it) => it.widget)).toEqual(readingOrder(board).map((it) => it.widget));
    expect(scaled[1].y).toBe(board[0].h);
  });
});

describe('reorderItem', () => {
  it('moves an item one place earlier and later in reading order', () => {
    const a = item('revenue', 0, 0, 3, 2);
    const b = item('activeMembers', 3, 0, 3, 2);
    const c = item('todaySchedule', 0, 2, 6, 5);
    const earlier = reorderItem([a, b, c], b.id, -1);
    expect(readingOrder(earlier).map((it) => it.id)).toEqual([b.id, a.id, c.id]);
    const later = reorderItem([a, b, c], b.id, 1);
    expect(readingOrder(later).map((it) => it.id)).toEqual([a.id, c.id, b.id]);
    expect(noOverlaps(later)).toBe(true);
  });

  it('is a no-op at either end', () => {
    const a = item('revenue', 0, 0, 3, 2);
    const b = item('activeMembers', 3, 0, 3, 2);
    expect(reorderItem([a, b], a.id, -1)).toEqual([a, b]);
    expect(reorderItem([a, b], b.id, 1)).toEqual([a, b]);
  });
});

describe('removeItem, normalizeLayout, layoutsEqual', () => {
  it('removes and compacts', () => {
    const a = item('quickActions', 0, 0, 12, 2);
    const b = item('revenue', 0, 2, 3, 2);
    expect(removeItem([a, b], a.id)).toEqual([{ ...b, y: 0 }]);
  });

  it('restores a removed item at its old position', () => {
    const a = item('quickActions', 0, 0, 12, 2);
    const b = item('revenue', 0, 2, 3, 2);
    const c = item('activeMembers', 3, 2, 3, 2);
    const before = [a, b, c];
    const after = removeItem(before, b.id);
    const restored = restoreItem(after, b);
    expect(noOverlaps(restored)).toBe(true);
    expect(layoutsEqual(restored, before)).toBe(true);
  });

  it('pushes cards that took the freed place down when restoring', () => {
    const a = item('revenue', 0, 0, 3, 2);
    const b = item('activeMembers', 3, 0, 3, 2);
    const moved = moveItem([b], b.id, 0, 0);
    const restored = restoreItem(moved, a);
    expect(noOverlaps(restored)).toBe(true);
    expect(restored.find((i) => i.id === a.id)).toMatchObject({ x: 0, y: 0 });
  });

  it('normalizes clamps and removes overlaps', () => {
    const result = normalizeLayout([item('revenue', 0, 0, 9, 9), item('activeMembers', 0, 0, 3, 2)]);
    expect(noOverlaps(result)).toBe(true);
    expect(result[0]).toMatchObject({ w: 4, h: 3 });
  });

  it('compares layouts by geometry and settings', () => {
    const a = item('revenue', 0, 0, 3, 2);
    expect(layoutsEqual([a], [{ ...a }])).toBe(true);
    expect(layoutsEqual([a], [{ ...a, x: 1 }])).toBe(false);
    expect(layoutsEqual([a], [{ ...a, settings: { period: 'today' } }])).toBe(false);
    expect(layoutsEqual([a], [])).toBe(false);
  });
});

describe('catalogue size rule', () => {
  it('has min <= default <= max and fits the 12 column grid', () => {
    for (const widget of DASHBOARD_WIDGETS) {
      const s = widget.size;
      expect(s.minW).toBeLessThanOrEqual(s.defaultW);
      expect(s.defaultW).toBeLessThanOrEqual(s.maxW);
      expect(s.minH).toBeLessThanOrEqual(s.defaultH);
      expect(s.defaultH).toBeLessThanOrEqual(s.maxH);
      expect(s.maxW).toBeLessThanOrEqual(12);
    }
    expect(getDashboardWidget('revenue').size).toMatchObject({ minW: 2, minH: 2, maxW: 4, maxH: 3 });
    expect(getDashboardWidget('revenueTrend').size).toMatchObject({ minW: 4, minH: 3, maxW: 12, maxH: 6 });
    expect(getDashboardWidget('todaySchedule').size).toMatchObject({ minW: 4, minH: 4, maxW: 12, maxH: 8 });
    expect(getDashboardWidget('weekCalendar').size).toMatchObject({ minW: 6, minH: 4, maxW: 12, maxH: 8 });
  });
});
