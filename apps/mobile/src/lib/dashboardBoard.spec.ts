import { DASHBOARD_GRID, layoutsEqual, normalizeLayout } from '@platform/shared';
import type { DashboardLayoutItem } from '@platform/shared';
import {
  dropOutcome,
  isOverTrash,
  isPointInRect,
  removeCard,
  restoreCard,
  singleColumnItems,
  singleColumnOrder,
  TRASH_HIT_SLOP,
  visibleMobileQuickActions,
} from './dashboardBoard';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function card(n: number, widget: DashboardLayoutItem['widget'], x: number, y: number, w: number, h: number): DashboardLayoutItem {
  return { id: ID(n), widget, x, y, w, h };
}

const board: DashboardLayoutItem[] = normalizeLayout([
  card(1, 'quickActions', 0, 0, 12, 1),
  card(2, 'revenue', 0, 1, 3, 2),
  card(3, 'activeMembers', 3, 1, 3, 2),
  card(4, 'occupancy', 6, 1, 3, 2),
  card(5, 'revenueTrend', 0, 3, 6, 4),
]);

describe('isPointInRect / isOverTrash', () => {
  const trash = { x: 100, y: 700, width: 160, height: 72 };

  it('hits inside the rect and misses outside', () => {
    expect(isPointInRect({ x: 120, y: 720 }, trash)).toBe(true);
    expect(isPointInRect({ x: 99, y: 720 }, trash)).toBe(false);
    expect(isPointInRect({ x: 120, y: 699 }, trash)).toBe(false);
  });

  it('counts the edges as inside', () => {
    expect(isPointInRect({ x: 100, y: 700 }, trash)).toBe(true);
    expect(isPointInRect({ x: 260, y: 772 }, trash)).toBe(true);
  });

  it('grows the target by the hit slop', () => {
    expect(isOverTrash({ x: 100 - TRASH_HIT_SLOP, y: 720 }, trash)).toBe(true);
    expect(isOverTrash({ x: 100 - TRASH_HIT_SLOP - 1, y: 720 }, trash)).toBe(false);
    expect(isOverTrash({ x: 180, y: 772 + TRASH_HIT_SLOP }, trash)).toBe(true);
  });

  it('never hits before the target has been measured', () => {
    expect(isOverTrash({ x: 0, y: 0 }, null)).toBe(false);
    expect(isOverTrash({ x: 0, y: 0 }, undefined)).toBe(false);
  });
});

describe('dropOutcome', () => {
  it('removes only when released over the trash', () => {
    expect(dropOutcome(true)).toBe('remove');
    expect(dropOutcome(false)).toBe('cancel');
  });
});

describe('single column order', () => {
  it('stacks cards in reading order, row first then column', () => {
    expect(singleColumnOrder(board)).toEqual([ID(1), ID(2), ID(3), ID(4), ID(5)]);
  });

  it('is independent of the array order and keeps the stored 12 column geometry', () => {
    const shuffled = [board[4], board[2], board[0], board[3], board[1]];
    expect(singleColumnItems(shuffled).map((i) => i.id)).toEqual([ID(1), ID(2), ID(3), ID(4), ID(5)]);
    expect(singleColumnItems(shuffled)[1]).toEqual(board[1]);
  });
});

describe('removeCard and restoreCard', () => {
  it('removes the card and compacts the 12 column layout', () => {
    const result = removeCard(board, ID(2));
    expect(result).not.toBeNull();
    expect(result?.removed).toEqual(board[1]);
    expect(result?.next.map((i) => i.id)).not.toContain(ID(2));
    expect(result?.next).toHaveLength(board.length - 1);
    expect(result?.next.every((i) => i.x + i.w <= DASHBOARD_GRID.columns)).toBe(true);
  });

  it('returns null for an unknown card', () => {
    expect(removeCard(board, ID(99))).toBeNull();
  });

  it('does not touch the input', () => {
    const copy = JSON.parse(JSON.stringify(board)) as DashboardLayoutItem[];
    removeCard(board, ID(3));
    expect(board).toEqual(copy);
  });

  it('undo restores the same layout', () => {
    const result = removeCard(board, ID(3));
    if (!result) throw new Error('expected a removal');
    const restored = restoreCard(result.next, result.removed);
    expect(layoutsEqual(restored, board)).toBe(true);
  });

  it('undo after a later removal brings back only the undone card', () => {
    const first = removeCard(board, ID(3));
    if (!first) throw new Error('expected a removal');
    const second = removeCard(first.next, ID(4));
    if (!second) throw new Error('expected a removal');
    const restored = restoreCard(second.next, first.removed);
    expect(restored.map((i) => i.id).sort()).toEqual([ID(1), ID(2), ID(3), ID(5)].sort());
  });
});

describe('visibleMobileQuickActions', () => {
  it('shows only actions with a mobile screen that the permissions unlock', () => {
    expect(visibleMobileQuickActions(['retail.sell'], false).map((a) => a.key)).toEqual(['quick-sale']);
    expect(visibleMobileQuickActions([], false)).toEqual([]);
  });

  it('shows every mobile action to the owner and none of the web only ones', () => {
    const keys = visibleMobileQuickActions([], true).map((a) => a.key);
    expect(keys).toEqual(['new-session', 'new-member', 'quick-sale', 'check-in']);
    expect(keys).not.toContain('sell-package');
    expect(keys).not.toContain('record-payment');
  });
});
