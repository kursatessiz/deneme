import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { THEME_FONT_ASSETS } from '../src/fonts';
import { SessionProvider } from '../src/lib/session';
import { ThemeProvider, useTheme } from '../src/theme';

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
