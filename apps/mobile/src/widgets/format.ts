import type { WidgetSummaryData } from './types';

/** Turkish, e.g. "1 Eki, 12:00". Kept short: widgets have little room. */
export function formatSessionTime(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    date,
  );
}

export function formatRemainingUnitsLabel(remainingUnits: number | null): string {
  if (remainingUnits == null) return 'Sinirsiz';
  return `${remainingUnits} hak kaldi`;
}

export interface WidgetDisplayModel {
  sessionTitle: string;
  sessionSubtitle: string;
  packageTitle: string;
  packageSubtitle: string;
}

const EMPTY_DISPLAY: WidgetDisplayModel = {
  sessionTitle: 'Yaklasan ders yok',
  sessionSubtitle: '',
  packageTitle: 'Aktif paket yok',
  packageSubtitle: '',
};

/** Converts the raw snapshot into ready-to-render strings for both widgets. */
export function toWidgetDisplayModel(data: WidgetSummaryData | null): WidgetDisplayModel {
  if (!data) return EMPTY_DISPLAY;

  const sessionTitle = data.nextSession ? data.nextSession.title : EMPTY_DISPLAY.sessionTitle;
  const sessionSubtitle = data.nextSession
    ? `${data.nextSession.studioName} - ${formatSessionTime(data.nextSession.startTime)}`
    : '';

  const packageTitle = data.activePackage ? data.activePackage.packageName : EMPTY_DISPLAY.packageTitle;
  const packageSubtitle = data.activePackage
    ? `${data.activePackage.studioName} - ${formatRemainingUnitsLabel(data.activePackage.remainingUnits)}`
    : '';

  return { sessionTitle, sessionSubtitle, packageTitle, packageSubtitle };
}
