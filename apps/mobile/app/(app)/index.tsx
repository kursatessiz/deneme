import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { ScreenContainer } from '../../src/components/ScreenContainer';
import { useSession } from '../../src/lib/session';
import { spacing, typography, useThemeColors } from '../../src/theme';

export default function HomeScreen() {
  const colors = useThemeColors();
  const { user, activeMembership } = useSession();

  return (
    <ScreenContainer>
      <Text style={[styles.greeting, { color: colors.textSecondary }]}>Merhaba,</Text>
      <Text style={[styles.name, { color: colors.textPrimary }]}>{user?.firstName ?? ''} {user?.lastName ?? ''}</Text>

      {activeMembership ? (
        <Text style={[styles.studio, { color: colors.textSecondary }]}>{activeMembership.studioName} stüdyosundasınız</Text>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  greeting: {
    fontSize: typography.size.sm,
    marginBottom: spacing[1],
  },
  name: {
    fontSize: typography.size['2xl'],
    fontWeight: typography.weight.bold,
    marginBottom: spacing[4],
  },
  studio: {
    fontSize: typography.size.md,
  },
});
