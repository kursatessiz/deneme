import { DASHBOARD_GRID, dashboardRowsToPx, layoutBottom, removeItem, restoreItem, scaleForColumns, tabletLayout } from '@platform/shared';
import type { DashboardLayoutItem, MessageKey, PermissionKey } from '@platform/shared';

/**
 * Pure logic of the mobile overview board (docs/MOBILE_APP.md, "Genel bakış
 * panosu"): the single column order, the long-press-to-trash gesture's
 * hit-testing, and the layout a removal and its undo produce. Screens only
 * wire these to touches and the API.
 */

/** How long a card must be held before it lifts. */
export const LONG_PRESS_MS = 400;
/** Finger travel (in points) during the hold that turns it into a scroll instead of a lift. */
export const LONG_PRESS_MOVE_SLOP = 10;
/** Extra reach around the trash target so a drop near it still counts. */
export const TRASH_HIT_SLOP = 24;
/** How long the "card removed, undo" banner stays. */
export const UNDO_WINDOW_MS = 6000;
/** Debounce between a layout change and the PUT that stores it. */
export const LAYOUT_SAVE_DELAY_MS = 800;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True when `point` lies inside `rect` grown by `slop` on every side. A missing rect never hits. */
export function isPointInRect(point: Point, rect: Rect | null | undefined, slop = 0): boolean {
  if (!rect) return false;
  return (
    point.x >= rect.x - slop &&
    point.x <= rect.x + rect.width + slop &&
    point.y >= rect.y - slop &&
    point.y <= rect.y + rect.height + slop
  );
}

/** Hit test of the trash target against the finger position (window coordinates). */
export function isOverTrash(finger: Point, trash: Rect | null | undefined): boolean {
  return isPointInRect(finger, trash, TRASH_HIT_SLOP);
}

/** Card ids in the order the single column board shows them (the engine's one column scaling). */
export function singleColumnOrder(items: readonly DashboardLayoutItem[]): string[] {
  return scaleForColumns(items, 1).map((item) => item.id);
}

/** The stored items sorted like the single column board, for rendering. */
export function singleColumnItems(items: readonly DashboardLayoutItem[]): DashboardLayoutItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return singleColumnOrder(items)
    .map((id) => byId.get(id))
    .filter((item): item is DashboardLayoutItem => item !== undefined);
}

/** Pixel frame of a card on the tablet board, relative to the board's top left corner. */
export interface TabletFrame {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TabletBoardGeometry {
  frames: TabletFrame[];
  /** Total height of the board in px. */
  height: number;
}

/**
 * Pixel geometry of the 6 column tablet board for a container `width` px
 * wide: the shared tabletLayout (widths 2, 4 or 6, dense packing) with the
 * shared row unit and gap, so web and mobile show the same arrangement.
 * Frames come in the input order; cards are never resized on tablets.
 */
export function tabletBoardGeometry(items: readonly DashboardLayoutItem[], width: number): TabletBoardGeometry {
  const columns = DASHBOARD_GRID.tabletColumns;
  const gap = DASHBOARD_GRID.gap;
  const placed = tabletLayout(items);
  const cell = Math.max(1, (width - gap * (columns - 1)) / columns);
  const frames = placed.map((item) => ({
    id: item.id,
    left: item.x * (cell + gap),
    top: item.y * (DASHBOARD_GRID.rowHeight + gap),
    width: item.w * cell + (item.w - 1) * gap,
    height: dashboardRowsToPx(item.h),
  }));
  const rows = layoutBottom(placed);
  return { frames, height: rows === 0 ? 0 : dashboardRowsToPx(rows) };
}

export interface RemovalResult {
  /** The 12 column layout without the card, compacted by the shared engine. */
  next: DashboardLayoutItem[];
  /** The card as it was, kept for the undo. */
  removed: DashboardLayoutItem;
}

/** Removes card `id` from the stored layout; null when the card is not there. */
export function removeCard(items: readonly DashboardLayoutItem[], id: string): RemovalResult | null {
  const removed = items.find((item) => item.id === id);
  if (!removed) return null;
  return { next: removeItem(items, id), removed };
}

/** Puts a removed card back at its old place (undo); cards that moved into its place are pushed down. */
export function restoreCard(items: readonly DashboardLayoutItem[], removed: DashboardLayoutItem): DashboardLayoutItem[] {
  return restoreItem(items, removed);
}

/** What a finished drag does: remove the card when released over the trash, otherwise nothing. */
export function dropOutcome(overTrash: boolean): 'remove' | 'cancel' {
  return overTrash ? 'remove' : 'cancel';
}

export interface MobileQuickAction {
  key: string;
  /** messages key of the label (the same labels the web quick action bar uses). */
  labelKey: MessageKey;
  /** expo-router route of an existing mobile screen. */
  route: string;
  /** Any one of these unlocks the action; owners always see it. */
  permissions: readonly PermissionKey[];
}

/**
 * The web board's quick actions that have a mobile screen. Actions without
 * one (sell package, record payment) are left out until the screen exists.
 */
export const MOBILE_QUICK_ACTIONS: readonly MobileQuickAction[] = [
  { key: 'new-session', labelKey: 'screens.dashboard.quickActions.newSession', route: '/(app)/hesabim/programim/yeni', permissions: ['schedule.manage'] },
  { key: 'new-member', labelKey: 'screens.dashboard.quickActions.newMember', route: '/(app)/hesabim/uyeler/yeni', permissions: ['members.manage'] },
  { key: 'quick-sale', labelKey: 'screens.dashboard.quickActions.quickSale', route: '/(app)/hesabim/hizli-satis', permissions: ['retail.sell'] },
  { key: 'check-in', labelKey: 'screens.dashboard.quickActions.checkIn', route: '/(app)/hesabim/resepsiyon-tarama', permissions: ['attendance.manage'] },
] as const;

export function visibleMobileQuickActions(permissions: readonly PermissionKey[], isOwner: boolean): MobileQuickAction[] {
  return MOBILE_QUICK_ACTIONS.filter((action) => isOwner || action.permissions.some((key) => permissions.includes(key)));
}
