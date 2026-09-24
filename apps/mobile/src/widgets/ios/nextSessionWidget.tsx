import { createWidget } from 'expo-widgets';
import { Text, VStack } from '@expo/ui/swift-ui';

import { toWidgetDisplayModel } from '../format';
import type { WidgetSummaryData } from '../types';

/**
 * iOS home-screen widget: next session and the most relevant active
 * package's remaining units. Registered under the name "NextSessionWidget",
 * which must match `widgets[].name` in app.json's expo-widgets plugin
 * config. Requires a development or EAS build (expo-widgets ships a native
 * WidgetKit extension); it never runs inside Expo Go.
 *
 * The function below is the widget's native layout: it is compiled ahead
 * of time by expo-widgets' bundler, so it must stay a pure function of its
 * props/environment (no app state, no network calls) -- all data reaches
 * it as plain, already-formatted strings pushed by `updateIosWidget`.
 */
function NextSessionWidgetLayout(props: WidgetSummaryData) {
  'widget';

  const display = toWidgetDisplayModel(props);

  return (
    <VStack spacing={4} alignment="leading">
      <Text>{display.sessionTitle}</Text>
      {display.sessionSubtitle ? <Text>{display.sessionSubtitle}</Text> : null}
      <Text>{display.packageTitle}</Text>
      {display.packageSubtitle ? <Text>{display.packageSubtitle}</Text> : null}
    </VStack>
  );
}

export const nextSessionWidget = createWidget<WidgetSummaryData>('NextSessionWidget', NextSessionWidgetLayout);

/** Pushes a fresh snapshot to the widget; called from refresh.ts on iOS. */
export function updateIosWidget(data: WidgetSummaryData | null): void {
  nextSessionWidget.updateSnapshot(
    data ?? { nextSession: null, activePackage: null, updatedAt: new Date(0).toISOString() },
  );
}
