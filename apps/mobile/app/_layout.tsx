import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { THEME_FONT_ASSETS } from '../src/fonts';
import { SessionProvider } from '../src/lib/session';
import { ThemeProvider, useTheme } from '../src/theme';
import { refreshWidgets } from '../src/widgets';

if (Platform.OS === 'android') {
  // Registers the Android widget headless task at bundle load, which also
  // covers invocations while the app UI is not running. Errors are logged inside.
  void import('../src/widgets/android/taskHandler').then(({ registerAndroidWidgetTaskHandler }) =>
    registerAndroidWidgetTaskHandler(),
  );
}

function ThemedStack() {
  const { theme } = useTheme();
  return (
    <>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }} />
    </>
  );
}

export default function RootLayout() {
  // System fonts render until the theme faces load; a failed load keeps them.
  const [fontsLoaded] = useFonts(THEME_FONT_ASSETS);

  useEffect(() => {
    // Widgets refresh on foreground so "next session" and remaining units
    // never go stale while the app was in the background.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshWidgets();
    });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <ThemeProvider fontsLoaded={fontsLoaded}>
          <ThemedStack />
        </ThemeProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
