import { createWidget } from 'expo-widgets';
import { Text, VStack } from '@expo/ui/swift-ui';

import type { WidgetDisplayModel } from '../format';

/**
 * iOS home-screen widget: next session and the most relevant active
 * package's remaining units. Registered under the name "NextSessionWidget",
 * which must match `widgets[].name` in app.json's expo-widgets plugin
 * config. Requires a development or EAS build (expo-widgets ships a native
 * WidgetKit extension); it never runs inside Expo Go.
 *
 * The function below is the widget's native layout: it is compiled ahead
 * of time by expo-widgets' bundler, so it must stay a pure function of its
 * props/environment (no app state, no network calls, no i18n context) --
 * all data reaches it as plain, already-translated strings resolved and
 * pushed by `updateIosWidget`.
 */
function NextSessionWidgetLayout(props: WidgetDisplayModel) {
  'widget';

  return (
    <VStack spacing={4} alignment="leading">
      <Text>{props.sessionTitle}</Text>
      {props.sessionSubtitle ? <Text>{props.sessionSubtitle}</Text> : null}
      <Text>{props.packageTitle}</Text>
      {props.packageSubtitle ? <Text>{props.packageSubtitle}</Text> : null}
    </VStack>
  );
}

export const nextSessionWidget = createWidget<WidgetDisplayModel>('NextSessionWidget', NextSessionWidgetLayout);

/** Pushes an already-translated display model to the widget; called from refresh.ts on iOS. */
export function updateIosWidget(display: WidgetDisplayModel): void {
  nextSessionWidget.updateSnapshot(display);
}
