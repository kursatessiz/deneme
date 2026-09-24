import * as SecureStore from 'expo-secure-store';

import { EMPTY_WIDGET_SUMMARY, WIDGET_STORAGE_KEY, type WidgetSummaryData } from './types';

/**
 * Persists the latest widget snapshot on-device so the Android headless
 * widget task (which runs without the React app or its in-memory state)
 * can render the widget from the last known data. iOS does not read this
 * store directly: expo-widgets keeps its own WidgetKit timeline, pushed by
 * `updateSnapshot` in refresh.ts.
 */
export async function saveWidgetSummary(data: WidgetSummaryData): Promise<void> {
  await SecureStore.setItemAsync(WIDGET_STORAGE_KEY, JSON.stringify(data));
}

export async function loadWidgetSummary(): Promise<WidgetSummaryData> {
  try {
    const raw = await SecureStore.getItemAsync(WIDGET_STORAGE_KEY);
    if (!raw) return EMPTY_WIDGET_SUMMARY;
    return JSON.parse(raw) as WidgetSummaryData;
  } catch {
    return EMPTY_WIDGET_SUMMARY;
  }
}

export async function clearWidgetSummary(): Promise<void> {
  await SecureStore.deleteItemAsync(WIDGET_STORAGE_KEY);
}
