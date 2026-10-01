import { Platform } from 'react-native';
import type { MeSummaryDTO } from '@platform/shared';

import { apiRequest } from '../lib/api';
import { getAccessToken } from '../lib/tokenStore';
import { toWidgetDisplayModel } from './format';
import { resolveWidgetTranslation } from './locale';
import { saveWidgetSummary, clearWidgetSummary, saveWidgetBrand, loadWidgetBrand } from './store';
import type { WidgetSummaryData } from './types';

/**
 * Refreshes the home-screen widgets from GET /me/summary. Called after
 * login, after a booking is created or cancelled, and on app foreground
 * (see app/_layout.tsx). No-ops quietly on any failure: a widget refresh
 * must never surface an error to the user or block the screen it was
 * triggered from.
 */
export async function refreshWidgets(): Promise<void> {
  try {
    const token = await getAccessToken();
    if (!token) {
      await clearWidgetsForSignedOutState();
      return;
    }

    const summary = await apiRequest<MeSummaryDTO>('/me/summary');
    const data = toWidgetSummaryData(summary);
    await saveWidgetSummary(data);
    await pushToNativeWidgets(data);
  } catch {
    // Best-effort: widgets keep showing their last known data.
  }
}

/**
 * Remembers the active studio's primary color for the Android widget and
 * redraws the widgets when it changed. Called by the session whenever the
 * active studio (or its theme) changes.
 */
export async function updateWidgetBrand(primary: string | null): Promise<void> {
  try {
    if ((await loadWidgetBrand()) === primary) return;
    await saveWidgetBrand(primary);
    await refreshWidgets();
  } catch {
    // Best-effort, like every widget refresh.
  }
}

export async function clearWidgetsForSignedOutState(): Promise<void> {
  try {
    await clearWidgetSummary();
    await saveWidgetBrand(null);
    await pushToNativeWidgets(null);
  } catch {
    // ignore
  }
}

function toWidgetSummaryData(summary: MeSummaryDTO): WidgetSummaryData {
  const nextSession = summary.nextBooking
    ? {
        title: summary.nextBooking.serviceName,
        studioName: summary.nextBooking.studioName,
        startTime: summary.nextBooking.startTime,
      }
    : null;

  // "Most relevant" active package: the one running out soonest.
  const allPackages = summary.studios.flatMap((s) => s.activePackages);
  const mostRelevant = [...allPackages].sort((a, b) => a.endDate.localeCompare(b.endDate))[0];
  const activePackage = mostRelevant
    ? {
        packageName: mostRelevant.packageName,
        studioName: mostRelevant.studioName,
        remainingUnits: mostRelevant.remainingUnits,
      }
    : null;

  return { nextSession, activePackage, updatedAt: new Date().toISOString() };
}

/** Pushes the new snapshot into the OS widget for the current platform, already translated. */
async function pushToNativeWidgets(data: WidgetSummaryData | null): Promise<void> {
  const { locale, t } = await resolveWidgetTranslation();
  const display = toWidgetDisplayModel(data, locale, t);

  if (Platform.OS === 'ios') {
    const { updateIosWidget } = await import('./ios/nextSessionWidget');
    updateIosWidget(display);
  } else if (Platform.OS === 'android') {
    const { updateAndroidWidgets } = await import('./android/nextSessionWidget');
    await updateAndroidWidgets(display, await loadWidgetBrand());
  }
}
