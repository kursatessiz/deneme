import type { DashboardLayoutItem } from '@platform/shared';
import { cellOrigin, columnWidth, distinctDataRequests, keyboardAction, pxToCell, pxToSpan, spanToPx, widgetDataKey } from './grid-math';

const m = { width: 12 * 80 + 11 * 16, columns: 12, rowHeight: 72, gap: 16 };

describe('grid metrics', () => {
  it('derives the column width from the grid width and the gaps', () => {
    expect(columnWidth(m)).toBe(80);
    expect(cellOrigin(m, 2, 3)).toEqual({ left: 192, top: 264 });
  });

  it('snaps a dropped corner to the nearest cell and keeps the card inside the grid', () => {
    expect(pxToCell(m, 190, 260, 3)).toEqual({ x: 2, y: 3 });
    expect(pxToCell(m, 140, 40, 3)).toEqual({ x: 1, y: 0 });
    expect(pxToCell(m, -50, -50, 3)).toEqual({ x: 0, y: 0 });
    expect(pxToCell(m, 5000, 100, 3)).toEqual({ x: 9, y: 1 });
  });

  it('converts between px and grid spans both ways', () => {
    const px = spanToPx(m, 3, 2);
    expect(px).toEqual({ width: 272, height: 160 });
    expect(pxToSpan(m, px.width, px.height)).toEqual({ w: 3, h: 2 });
    expect(pxToSpan(m, px.width + 40, px.height + 30)).toEqual({ w: 3, h: 2 });
    expect(pxToSpan(m, px.width + 60, px.height + 60)).toEqual({ w: 4, h: 3 });
    expect(pxToSpan(m, 2, 2)).toEqual({ w: 1, h: 1 });
  });
});

describe('keyboardAction', () => {
  it('maps arrows to moves and Shift+arrows to resizes', () => {
    expect(keyboardAction('ArrowRight', false)).toEqual({ type: 'move', dx: 1, dy: 0 });
    expect(keyboardAction('ArrowUp', false)).toEqual({ type: 'move', dx: 0, dy: -1 });
    expect(keyboardAction('ArrowDown', true)).toEqual({ type: 'resize', dw: 0, dh: 1 });
    expect(keyboardAction('ArrowLeft', true)).toEqual({ type: 'resize', dw: -1, dh: 0 });
  });

  it('maps removal and cancel keys and ignores the rest', () => {
    expect(keyboardAction('Delete', false)).toEqual({ type: 'remove' });
    expect(keyboardAction('Backspace', false)).toEqual({ type: 'remove' });
    expect(keyboardAction('Escape', false)).toEqual({ type: 'cancel' });
    expect(keyboardAction('a', false)).toBeNull();
    expect(keyboardAction('Enter', false)).toBeNull();
  });
});

describe('data keys', () => {
  const item = (id: string, widget: DashboardLayoutItem['widget'], period?: 'today' | 'month'): DashboardLayoutItem => ({
    id,
    widget,
    x: 0,
    y: 0,
    w: 3,
    h: 2,
    ...(period ? { settings: { period } } : {}),
  });

  it('resolves the default period so an unset and an explicit default share a key', () => {
    expect(widgetDataKey('revenue', undefined, null)).toBe(widgetDataKey('revenue', { period: 'month' }, null));
    expect(widgetDataKey('revenue', { period: 'today' }, null)).not.toBe(widgetDataKey('revenue', undefined, null));
    expect(widgetDataKey('revenue', undefined, 'b1')).not.toBe(widgetDataKey('revenue', undefined, null));
  });

  it('requests each distinct card once and skips client-only cards', () => {
    const items = [item('1', 'revenue'), item('2', 'revenue', 'month'), item('3', 'revenue', 'today'), item('4', 'quickActions')];
    const requests = distinctDataRequests(items, null, (w) => w === 'quickActions');
    expect(requests.map((r) => r.item.id)).toEqual(['1', '3']);
  });
});
