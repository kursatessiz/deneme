'use client';

import { useEffect, useState } from 'react';
import { DASHBOARD_GRID } from '@platform/shared';
import type { DashboardColumnCount } from '@platform/shared';

/** 12, 6 or 1 columns from the viewport width (DASHBOARD_GRID.breakpoints), updated on resize. */
export function useDashboardColumns(): DashboardColumnCount {
  const [columns, setColumns] = useState<DashboardColumnCount>(DASHBOARD_GRID.columns);
  useEffect(() => {
    const wide = window.matchMedia(`(min-width: ${DASHBOARD_GRID.breakpoints.wide}px)`);
    const tablet = window.matchMedia(`(min-width: ${DASHBOARD_GRID.breakpoints.tablet}px)`);
    const update = () => setColumns(wide.matches ? DASHBOARD_GRID.columns : tablet.matches ? DASHBOARD_GRID.tabletColumns : 1);
    update();
    wide.addEventListener('change', update);
    tablet.addEventListener('change', update);
    return () => {
      wide.removeEventListener('change', update);
      tablet.removeEventListener('change', update);
    };
  }, []);
  return columns;
}

/** True when the user asked the system for less motion. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}
