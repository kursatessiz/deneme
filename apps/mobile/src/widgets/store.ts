import * as SecureStore from 'expo-secure-store';

import { EMPTY_WIDGET_SUMMARY, WIDGET_BRAND_STORAGE_KEY, WIDGET_STORAGE_KEY, type WidgetSummaryData } from './types';

const HEX = /^#[0-9a-fA-F]{6}$/;

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

/**
 * Caches the active studio's primary color (#RRGGBB) for the Android widget,
 * which has no access to the app's session or theme context. `null` clears it.
 */
export async function saveWidgetBrand(primary: string | null): Promise<void> {
  if (primary && HEX.test(primary)) await SecureStore.setItemAsync(WIDGET_BRAND_STORAGE_KEY, primary);
  else await SecureStore.deleteItemAsync(WIDGET_BRAND_STORAGE_KEY);
}

export async function loadWidgetBrand(): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(WIDGET_BRAND_STORAGE_KEY);
    return raw && HEX.test(raw) ? raw : null;
  } catch {
    return null;
  }
}
