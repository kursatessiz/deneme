/**
 * Tablet breakpoint used across staff screens (owner/reception): calendar +
 * detail, member list + member card. Phone keeps the single-pane stack.
 * See CLAUDE.md "Mobil uygulama kuralları".
 */
export const TABLET_BREAKPOINT = 768;

export type LayoutMode = 'phone' | 'tablet';

/** Pure breakpoint selection so it is unit-testable without rendering. */
export function selectLayout(width: number): LayoutMode {
  return width >= TABLET_BREAKPOINT ? 'tablet' : 'phone';
}

export function isTabletWidth(width: number): boolean {
  return selectLayout(width) === 'tablet';
}
