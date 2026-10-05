'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import {
  DASHBOARD_GRID,
  getDashboardWidget,
  layoutsEqual,
  moveItem,
  nudgeItem,
  readingOrder,
  reorderItem,
  resizeItem,
  resizeLimitHit,
  resolveWidgetPeriod,
  scaleForColumns,
} from '@platform/shared';
import type { DashboardColumnCount, DashboardLayoutItem, DashboardPeriod } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { cellOrigin, defaultMetrics, keyboardAction, pxToCell, pxToSpan, spanToPx } from '@/lib/dashboard/grid-math';
import type { GridMetrics } from '@/lib/dashboard/grid-math';
import type { WidgetDataState } from '@/lib/dashboard/use-dashboard-data';
import { DashboardCard } from './DashboardCard';
import { WIDGET_VIEWS, WidgetContent } from './widgets';

interface Interaction {
  kind: 'move' | 'resize';
  id: string;
  base: DashboardLayoutItem[];
  preview: DashboardLayoutItem[];
  /** Pixel offset of the dragged card from its snapped cell (move only). */
  dx: number;
  dy: number;
  atLimit: boolean;
}

interface PointerSession {
  pointerId: number;
  kind: 'move' | 'resize';
  id: string;
  startX: number;
  startY: number;
  metrics: GridMetrics;
  originLeft: number;
  originTop: number;
  startWidth: number;
  startHeight: number;
  base: DashboardLayoutItem[];
  lastX: number;
  lastY: number;
  frame: number;
  target: HTMLElement;
}

/** The layout a pointer gesture would produce at its latest pointer position. */
function gesturePreview(s: PointerSession): Interaction | null {
  const item = s.base.find((i) => i.id === s.id);
  if (!item) return null;
  const deltaX = s.lastX - s.startX;
  const deltaY = s.lastY - s.startY;
  if (s.kind === 'move') {
    const left = s.originLeft + deltaX;
    const top = s.originTop + deltaY;
    const cell = pxToCell(s.metrics, left, top, item.w);
    const preview = moveItem(s.base, s.id, cell.x, cell.y);
    const moved = preview.find((i) => i.id === s.id) ?? item;
    const origin = cellOrigin(s.metrics, moved.x, moved.y);
    return { kind: 'move', id: s.id, base: s.base, preview, dx: left - origin.left, dy: top - origin.top, atLimit: false };
  }
  const span = pxToSpan(s.metrics, s.startWidth + deltaX, s.startHeight + deltaY);
  const limit = resizeLimitHit(item, span.w, span.h);
  const preview = resizeItem(s.base, s.id, span.w, span.h);
  return { kind: 'resize', id: s.id, base: s.base, preview, dx: 0, dy: 0, atLimit: span.w !== limit.w || span.h !== limit.h };
}

export interface DashboardGridProps {
  items: DashboardLayoutItem[];
  columns: DashboardColumnCount;
  editing: boolean;
  getData: (item: DashboardLayoutItem) => WidgetDataState;
  onRetry: (item: DashboardLayoutItem) => void;
  onChange: (next: DashboardLayoutItem[]) => void;
  onRemoveRequest: (item: DashboardLayoutItem) => void;
  announce: (message: string) => void;
}

/**
 * The card grid. Positions come from the stored 12 column layout (scaled
 * for 6 and 1 columns). In edit mode on the wide grid a card is dragged by
 * its grip and resized from its corner with pointer events and pointer
 * capture; moves are throttled to one layout pass per animation frame and
 * the grid is measured once per gesture. Every card can also be moved and
 * resized from the keyboard, and on narrow screens reordered from its menu.
 */
export function DashboardGrid({ items, columns, editing, getData, onRetry, onChange, onRemoveRequest, announce }: DashboardGridProps) {
  const t = useT();
  const helpId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const session = useRef<PointerSession | null>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const wide = columns === DASHBOARD_GRID.columns;
  const pointerEditing = editing && wide;

  const titleOf = useCallback((item: DashboardLayoutItem) => t(getDashboardWidget(item.widget).titleKey), [t]);

  const source = interaction ? interaction.preview : items;
  const placed = useMemo(() => scaleForColumns(source, columns), [source, columns]);
  const order = useMemo(() => readingOrder(items).map((i) => i.id), [items]);
  const ordered = useMemo(() => {
    const byId = new Map(placed.map((p) => [p.id, p]));
    return order.map((id) => byId.get(id)).filter((p): p is DashboardLayoutItem => !!p);
  }, [placed, order]);

  // Keep keyboard focus on a card after the DOM order follows its new position.
  useEffect(() => {
    if (!focusId) return;
    cardRefs.current.get(focusId)?.focus({ preventScroll: false });
    setFocusId(null);
  }, [focusId, ordered]);

  const describePosition = useCallback(
    (item: DashboardLayoutItem) => t('dashboard.announce.moved', { title: titleOf(item), column: item.x + 1, row: item.y + 1 }),
    [t, titleOf],
  );
  const describeSize = useCallback(
    (item: DashboardLayoutItem) => t('dashboard.announce.resized', { title: titleOf(item), width: item.w, height: item.h }),
    [t, titleOf],
  );

  // ---- Pointer gestures -------------------------------------------------------

  const endSession = useCallback(() => {
    const s = session.current;
    if (!s) return;
    if (s.frame) cancelAnimationFrame(s.frame);
    try {
      if (s.target.hasPointerCapture(s.pointerId)) s.target.releasePointerCapture(s.pointerId);
    } catch {
      // The element may already be gone.
    }
    session.current = null;
  }, []);

  const cancelGesture = useCallback(() => {
    if (!session.current) return;
    endSession();
    setInteraction(null);
    announce(t('dashboard.announce.cancelled'));
  }, [announce, endSession, t]);

  const computeFrame = useCallback(() => {
    const s = session.current;
    if (!s) return;
    s.frame = 0;
    const next = gesturePreview(s);
    if (next) setInteraction(next);
  }, []);

  const startGesture = useCallback(
    (kind: 'move' | 'resize', item: DashboardLayoutItem, e: PointerEvent<HTMLElement>) => {
      if (!pointerEditing || !gridRef.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const rect = gridRef.current.getBoundingClientRect();
      const metrics = defaultMetrics(rect.width, DASHBOARD_GRID.columns);
      const origin = cellOrigin(metrics, item.x, item.y);
      const size = spanToPx(metrics, item.w, item.h);
      session.current = {
        pointerId: e.pointerId,
        kind,
        id: item.id,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        metrics,
        originLeft: origin.left,
        originTop: origin.top,
        startWidth: size.width,
        startHeight: size.height,
        base: items,
        frame: 0,
        target,
      };
      setInteraction({ kind, id: item.id, base: items, preview: items, dx: 0, dy: 0, atLimit: false });

      const onMove = (ev: globalThis.PointerEvent) => {
        const s = session.current;
        if (!s || ev.pointerId !== s.pointerId) return;
        s.lastX = ev.clientX;
        s.lastY = ev.clientY;
        if (!s.frame) s.frame = requestAnimationFrame(computeFrame);
      };
      const finish = (ev: globalThis.PointerEvent) => {
        const s = session.current;
        if (!s || ev.pointerId !== s.pointerId) return;
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', finish);
        target.removeEventListener('pointercancel', abort);
        s.lastX = ev.clientX;
        s.lastY = ev.clientY;
        const final = gesturePreview(s);
        endSession();
        setInteraction(null);
        if (final && !layoutsEqual(final.preview, final.base)) {
          const changed = final.preview.find((i) => i.id === final.id);
          onChange(final.preview);
          if (changed) announce(final.kind === 'move' ? describePosition(changed) : describeSize(changed));
        }
      };
      const abort = (ev: globalThis.PointerEvent) => {
        if (session.current && ev.pointerId === session.current.pointerId) {
          target.removeEventListener('pointermove', onMove);
          target.removeEventListener('pointerup', finish);
          target.removeEventListener('pointercancel', abort);
          cancelGesture();
        }
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', finish);
      target.addEventListener('pointercancel', abort);
    },
    [announce, cancelGesture, computeFrame, describePosition, describeSize, endSession, items, onChange, pointerEditing],
  );

  // Escape cancels a pointer drag or resize from anywhere.
  useEffect(() => {
    if (!interaction) return;
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelGesture();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [interaction, cancelGesture]);

  // Leaving edit mode or changing the column count drops any half finished gesture.
  useEffect(() => {
    if (!pointerEditing && session.current) {
      endSession();
      setInteraction(null);
    }
  }, [pointerEditing, endSession]);

  // ---- Keyboard ------------------------------------------------------------------

  const onCardKey = useCallback(
    (item: DashboardLayoutItem, e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      const action = keyboardAction(e.key, e.shiftKey);
      if (!action) return;
      e.preventDefault();
      if (action.type === 'cancel') {
        cancelGesture();
        return;
      }
      if (action.type === 'remove') {
        onRemoveRequest(item);
        return;
      }
      if (action.type === 'move') {
        let next: DashboardLayoutItem[];
        if (wide) next = nudgeItem(items, item.id, action.dx, action.dy);
        else if (action.dy !== 0) next = reorderItem(items, item.id, action.dy > 0 ? 1 : -1);
        else next = items;
        const moved = next.find((i) => i.id === item.id);
        if (!moved || layoutsEqual(next, items)) {
          announce(t('dashboard.announce.cannotMove', { title: titleOf(item) }));
          return;
        }
        onChange(next);
        setFocusId(item.id);
        announce(wide ? describePosition(moved) : t('dashboard.announce.reordered', { title: titleOf(item), position: readingOrder(next).findIndex((i) => i.id === item.id) + 1, total: next.length }));
        return;
      }
      if (!wide) {
        announce(t('dashboard.announce.resizeWideOnly'));
        return;
      }
      const limit = resizeLimitHit(item, item.w + action.dw, item.h + action.dh);
      if (limit.w === item.w && limit.h === item.h) {
        const growing = action.dw > 0 || action.dh > 0;
        announce(t(growing ? 'dashboard.announce.atMax' : 'dashboard.announce.atMin', { title: titleOf(item), width: item.w, height: item.h }));
        return;
      }
      const next = resizeItem(items, item.id, limit.w, limit.h);
      const resized = next.find((i) => i.id === item.id);
      onChange(next);
      setFocusId(item.id);
      if (resized) announce(describeSize(resized));
    },
    [announce, cancelGesture, describePosition, describeSize, items, onChange, onRemoveRequest, t, titleOf, wide],
  );

  const onMenuMove = useCallback(
    (item: DashboardLayoutItem, direction: -1 | 1) => {
      const next = reorderItem(items, item.id, direction);
      if (layoutsEqual(next, items)) return;
      onChange(next);
      setFocusId(item.id);
      announce(t('dashboard.announce.reordered', { title: titleOf(item), position: readingOrder(next).findIndex((i) => i.id === item.id) + 1, total: next.length }));
    },
    [announce, items, onChange, t, titleOf],
  );

  const onPeriodChange = useCallback(
    (item: DashboardLayoutItem, period: DashboardPeriod) => {
      onChange(items.map((i) => (i.id === item.id ? { ...i, settings: { ...i.settings, period } } : i)));
    },
    [items, onChange],
  );

  const draggedPreview = interaction ? interaction.preview.find((i) => i.id === interaction.id) : undefined;
  const placeholder = interaction && draggedPreview && wide ? draggedPreview : null;
  const gridStyle = {
    '--ui-dash-cols': String(columns),
    '--ui-dash-row': `${DASHBOARD_GRID.rowHeight}px`,
    '--ui-dash-gap': `${DASHBOARD_GRID.gap}px`,
  } as React.CSSProperties;

  return (
    <>
      <p id={helpId} className="sr-only">
        {wide ? t('dashboard.keyboard.help') : t('dashboard.keyboard.helpNarrow')}
      </p>
      <div ref={gridRef} className="ui-dash-grid" style={gridStyle} data-testid="dashboard-grid" data-columns={columns} data-editing={editing ? 'true' : 'false'}>
        {placeholder ? (
          <div
            className="ui-dash-placeholder"
            aria-hidden="true"
            style={{ gridColumn: `${placeholder.x + 1} / span ${placeholder.w}`, gridRow: `${placeholder.y + 1} / span ${placeholder.h}` }}
          />
        ) : null}
        {ordered.map((pos) => {
          const item = items.find((i) => i.id === pos.id) ?? pos;
          const definition = getDashboardWidget(item.widget);
          const dragging = interaction?.id === item.id;
          const index = order.indexOf(item.id);
          const transform = dragging && interaction?.kind === 'move' ? `translate(${interaction.dx}px, ${interaction.dy}px)` : undefined;
          const sizeLabel = dragging && interaction?.kind === 'resize' ? t('dashboard.card.size', { width: pos.w, height: pos.h }) : null;
          return (
            <DashboardCard
              key={item.id}
              ref={(el) => {
                if (el) cardRefs.current.set(item.id, el);
                else cardRefs.current.delete(item.id);
              }}
              id={item.id}
              title={t(definition.titleKey)}
              description={t(definition.descriptionKey)}
              period={resolveWidgetPeriod(item.widget, item.settings)}
              periods={definition.settings?.periods ?? []}
              view={WIDGET_VIEWS[item.widget]}
              editing={editing}
              pointerEditing={pointerEditing}
              dragging={dragging}
              atLimit={dragging && (interaction?.atLimit ?? false)}
              sizeLabel={sizeLabel}
              canMoveUp={index > 0}
              canMoveDown={index >= 0 && index < order.length - 1}
              keyboardHelpId={helpId}
              geometry={{ x: item.x, y: item.y, w: item.w, h: item.h }}
              style={{
                gridColumn: `${pos.x + 1} / span ${pos.w}`,
                gridRow: `${pos.y + 1} / span ${pos.h}`,
                transform,
                pointerEvents: interaction && !dragging ? 'none' : undefined,
              }}
              onHandlePointerDown={(e) => startGesture('move', item, e)}
              onResizePointerDown={(e) => startGesture('resize', item, e)}
              onKeyDown={(e) => onCardKey(item, e)}
              onPeriodChange={(p) => onPeriodChange(item, p)}
              onMove={(direction) => onMenuMove(item, direction)}
              onRemove={() => onRemoveRequest(item)}
            >
              <WidgetContent item={item} state={getData(item)} onRetry={() => onRetry(item)} />
            </DashboardCard>
          );
        })}
      </div>
    </>
  );
}
