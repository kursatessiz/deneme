import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useSession } from '../src/lib/session';
import { useThemeColors } from '../src/theme';

/** Entry route: waits for the persisted session to restore, then routes. */
export default function Index() {
  const { isLoading, user } = useSession();
  const colors = useThemeColors();

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.textPrimary} />
      </View>
    );
  }

  return <Redirect href={user ? '/(app)' : '/(auth)/login'} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
