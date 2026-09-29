import type { Translate } from '@platform/shared';

import type { WidgetSummaryData } from './types';

/** e.g. "1 Oct, 12:00" (or the Turkish equivalent); kept short as widgets have little room. */
export function formatSessionTime(iso: string, locale: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    date,
  );
}

export function formatRemainingUnitsLabel(remainingUnits: number | null, t: Translate): string {
  if (remainingUnits == null) return t('mWidgets.unlimited');
  return t('mWidgets.remainingUnits', { count: remainingUnits });
}

export interface WidgetDisplayModel {
  sessionTitle: string;
  sessionSubtitle: string;
  packageTitle: string;
  packageSubtitle: string;
}

/** Converts the raw snapshot into ready-to-render, already-translated strings for both widgets. */
export function toWidgetDisplayModel(data: WidgetSummaryData | null, locale: string, t: Translate): WidgetDisplayModel {
  const emptySessionTitle = t('mWidgets.noUpcomingSession');
  const emptyPackageTitle = t('mWidgets.noActivePackage');

  if (!data) {
    return { sessionTitle: emptySessionTitle, sessionSubtitle: '', packageTitle: emptyPackageTitle, packageSubtitle: '' };
  }

  const sessionTitle = data.nextSession ? data.nextSession.title : emptySessionTitle;
  const sessionSubtitle = data.nextSession
    ? `${data.nextSession.studioName} - ${formatSessionTime(data.nextSession.startTime, locale)}`
    : '';

  const packageTitle = data.activePackage ? data.activePackage.packageName : emptyPackageTitle;
  const packageSubtitle = data.activePackage
    ? `${data.activePackage.studioName} - ${formatRemainingUnitsLabel(data.activePackage.remainingUnits, t)}`
    : '';

  return { sessionTitle, sessionSubtitle, packageTitle, packageSubtitle };
}
