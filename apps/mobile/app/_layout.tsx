import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider } from '../src/lib/session';
import { refreshWidgets } from '../src/widgets';

if (Platform.OS === 'android') {
  // Registers the Android widget headless task at JS bundle load, which
  // also covers invocations while the app UI is not running.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- fire-and-forget module side effect, errors are logged inside
  import('../src/widgets/android/taskHandler').then(({ registerAndroidWidgetTaskHandler }) =>
    registerAndroidWidgetTaskHandler(),
  );
}

export default function RootLayout() {
  useEffect(() => {
    // Widgets refresh on foreground so "next session" and remaining units
    // never go stale while the app was backgrounded.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshWidgets();
    });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
