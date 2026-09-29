import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary as RootErrorBoundary } from '../src/errors/ErrorBoundary';
import { ErrorFallback } from '../src/errors/ErrorFallback';
import { ErrorTelemetry } from '../src/errors/ErrorTelemetry';
import { installErrorReporting } from '../src/errors/runtime';
import { THEME_FONT_ASSETS } from '../src/fonts';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/lib/session';
import { ThemeProvider, useTheme } from '../src/theme';
import { refreshWidgets } from '../src/widgets';

// Global JS error handler, unhandled rejections and the offline queue flush (H2, docs/HATA_RAPORLAMA.md).
installErrorReporting();

/** Expo Router renders this for errors thrown by a route below the root layout. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return <ErrorFallback error={error} onRetry={() => void retry()} />;
}

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
    <RootErrorBoundary>
      <SafeAreaProvider>
        <SessionProvider>
          <I18nProvider>
            <ThemeProvider fontsLoaded={fontsLoaded}>
              <ErrorTelemetry />
              <ThemedStack />
            </ThemeProvider>
          </I18nProvider>
        </SessionProvider>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}
