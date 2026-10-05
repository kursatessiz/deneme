import { spacing } from '../design/tokens';

/**
 * Geometry of the overview page's card grid (docs/WEB_PANEL.md, "Genel
 * bakış kartları"). Layouts are always stored in the wide 12 column space;
 * narrower screens derive their arrangement from it (scaleForColumns) and
 * never write it back.
 */
export const DASHBOARD_GRID = {
  /** Columns of the stored layout and of screens at least `breakpoints.wide` px wide. */
  columns: 12,
  /** Columns between `breakpoints.tablet` and `breakpoints.wide`. */
  tabletColumns: 6,
  /** Height of one grid row in px; a card of height h is h rows plus the gaps between them. */
  rowHeight: 72,
  /** Gap between cells in px (the spacing token 4). */
  gap: spacing[4],
  /** Viewport widths (px) at which the grid switches to 12 and 6 columns; below `tablet` it is one column. */
  breakpoints: { wide: 1280, tablet: 768 },
  /** Most cards one board may hold. */
  maxItems: 30,
  /** Largest y a stored card may start at (keeps a corrupt payload from creating an endless page). */
  maxY: 400,
  /** Schema version of the stored layout. */
  version: 1,
} as const;

export type DashboardColumnCount = 12 | 6 | 1;

/** Number of columns the grid uses at a viewport width. */
export function dashboardColumnsForWidth(width: number): DashboardColumnCount {
  if (width >= DASHBOARD_GRID.breakpoints.wide) return DASHBOARD_GRID.columns;
  if (width >= DASHBOARD_GRID.breakpoints.tablet) return DASHBOARD_GRID.tabletColumns;
  return 1;
}

/** Height in px of a card that spans `h` rows. */
export function dashboardRowsToPx(h: number): number {
  return h * DASHBOARD_GRID.rowHeight + Math.max(0, h - 1) * DASHBOARD_GRID.gap;
}
