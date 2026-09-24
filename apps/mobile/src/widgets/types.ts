/**
 * Plain data shape the home-screen widgets render. Kept deliberately small
 * and JSON-serializable: it is persisted to native storage so the widget
 * can render before, or without, the React app being loaded (iOS
 * WidgetKit timeline / Android headless widget task).
 */
export interface WidgetSummaryData {
  nextSession: {
    title: string;
    studioName: string;
    /** ISO 8601, e.g. "2026-10-01T09:00:00.000Z". */
    startTime: string;
  } | null;
  /** Most relevant active package to show remaining units for, if any. */
  activePackage: {
    packageName: string;
    studioName: string;
    /** null for a time-unlimited package (no unit counter to show). */
    remainingUnits: number | null;
  } | null;
  /** When this snapshot was written, for a "guncelleniyor" staleness check. */
  updatedAt: string;
}

export const EMPTY_WIDGET_SUMMARY: WidgetSummaryData = {
  nextSession: null,
  activePackage: null,
  updatedAt: new Date(0).toISOString(),
};

export const WIDGET_STORAGE_KEY = 'widget-summary-v1';
