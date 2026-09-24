import React from 'react';
import { FlexWidget, TextWidget, requestWidgetUpdate } from 'react-native-android-widget';

import { toWidgetDisplayModel } from '../format';
import type { WidgetSummaryData } from '../types';

/** Widget name; must match `widgets[].name` in app.json's android widget config. */
export const ANDROID_WIDGET_NAME = 'NextSessionWidget';

/** Renders the Android app-widget layout for a given snapshot. */
export function NextSessionAndroidWidget({ data }: { data: WidgetSummaryData | null }) {
  const display = toWidgetDisplayModel(data);

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        padding: 12,
        borderRadius: 16,
      }}
      clickAction="OPEN_APP"
    >
      <TextWidget text={display.sessionTitle} style={{ fontSize: 14, fontWeight: 'bold', color: '#14120f' }} />
      {display.sessionSubtitle ? (
        <TextWidget text={display.sessionSubtitle} style={{ fontSize: 12, color: '#585349' }} />
      ) : null}
      <TextWidget
        text={display.packageTitle}
        style={{ fontSize: 12, fontWeight: 'bold', color: '#14120f', marginTop: 8 }}
      />
      {display.packageSubtitle ? (
        <TextWidget text={display.packageSubtitle} style={{ fontSize: 11, color: '#585349' }} />
      ) : null}
    </FlexWidget>
  );
}

/** Immediately re-renders any placed widgets while the app is running. */
export async function updateAndroidWidgets(data: WidgetSummaryData | null): Promise<void> {
  await requestWidgetUpdate({
    widgetName: ANDROID_WIDGET_NAME,
    renderWidget: () => <NextSessionAndroidWidget data={data} />,
  });
}
