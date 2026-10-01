import React from 'react';
import { FlexWidget, TextWidget, requestWidgetUpdate } from 'react-native-android-widget';
import type { HexColor, WidgetRepresentation } from 'react-native-android-widget';

import { widgetPalette } from '@platform/shared';
import type { ColorMode } from '@platform/shared';

import type { WidgetDisplayModel } from '../format';

/** Widget name; must match `widgets[].name` in app.json's android widget config. */
export const ANDROID_WIDGET_NAME = 'NextSessionWidget';

/**
 * Renders the Android app-widget layout for an already-translated display
 * model, in one color mode. The widget runs in a headless task without the
 * app's theme context, so it reads the plain palette from the design tokens
 * (`widgetPalette`), with the studio's primary color when it is cached.
 */
export function NextSessionAndroidWidget({
  display,
  mode = 'light',
  primary = null,
}: {
  display: WidgetDisplayModel;
  mode?: ColorMode;
  primary?: string | null;
}) {
  const p = widgetPalette(mode, primary);
  // The palette values are plain #rrggbb strings (checked in packages/shared widget.spec.ts); the widget API wants the template type.
  const hex = (value: string): HexColor => value as HexColor;
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'center',
        backgroundColor: hex(p.background),
        borderColor: hex(p.border),
        borderWidth: 1,
        padding: 12,
        borderRadius: 16,
      }}
      clickAction="OPEN_APP"
    >
      <TextWidget text={display.sessionTitle} style={{ fontSize: 14, fontWeight: 'bold', color: hex(p.text) }} />
      {display.sessionSubtitle ? (
        <TextWidget text={display.sessionSubtitle} style={{ fontSize: 12, color: hex(p.textMuted) }} />
      ) : null}
      <TextWidget
        text={display.packageTitle}
        style={{ fontSize: 12, fontWeight: 'bold', color: hex(p.themeText), marginTop: 8 }}
      />
      {display.packageSubtitle ? (
        <TextWidget text={display.packageSubtitle} style={{ fontSize: 11, color: hex(p.textMuted) }} />
      ) : null}
    </FlexWidget>
  );
}

/**
 * Both color variants of the widget. react-native-android-widget exposes the
 * system light/dark choice as a `{ light, dark }` pair: the launcher picks the
 * variant that matches the device's mode, so the widget follows it without
 * any hook or hint of its own.
 */
export function androidWidgetRepresentation(display: WidgetDisplayModel, primary: string | null): WidgetRepresentation {
  return {
    light: <NextSessionAndroidWidget display={display} mode="light" primary={primary} />,
    dark: <NextSessionAndroidWidget display={display} mode="dark" primary={primary} />,
  };
}

/** Immediately re-renders any placed widgets while the app is running, from an already-translated display model. */
export async function updateAndroidWidgets(display: WidgetDisplayModel, primary: string | null = null): Promise<void> {
  await requestWidgetUpdate({
    widgetName: ANDROID_WIDGET_NAME,
    renderWidget: () => androidWidgetRepresentation(display, primary),
  });
}
