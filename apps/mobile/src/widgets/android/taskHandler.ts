import React from 'react';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import type { WidgetTaskHandler } from 'react-native-android-widget';

import { toWidgetDisplayModel } from '../format';
import { resolveWidgetTranslation } from '../locale';
import { loadWidgetSummary } from '../store';
import { NextSessionAndroidWidget } from './nextSessionWidget';

/**
 * Handles Android widget lifecycle events (added, updated, resized,
 * deleted, clicked) while the app process is not necessarily foregrounded.
 * Renders from the last snapshot persisted by refresh.ts -- this handler
 * runs in a headless JS context with no React app state of its own.
 */
const nextSessionTaskHandler: WidgetTaskHandler = async ({ widgetAction, renderWidget }) => {
  if (widgetAction === 'WIDGET_DELETED') return;

  const data = await loadWidgetSummary();
  const { locale, t } = await resolveWidgetTranslation();
  const display = toWidgetDisplayModel(data, locale, t);
  renderWidget(React.createElement(NextSessionAndroidWidget, { display }));
};

/** Call once at JS bundle load (see app/_layout.tsx) so it also registers
 * for headless invocations, not just while the app UI is open. */
export function registerAndroidWidgetTaskHandler(): void {
  registerWidgetTaskHandler(nextSessionTaskHandler);
}
