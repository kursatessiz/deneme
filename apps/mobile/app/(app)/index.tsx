import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { onColor } from '@platform/shared';

import { GradientSurface } from '../../src/components/GradientSurface';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { useSession } from '../../src/lib/session';
import { radii, spacing, typography, useTheme, useThemeColors, useThemeFonts } from '../../src/theme';

export default function HomeScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const colors = useThemeColors();
  const { user, activeMembership } = useSession();
  const onBand = onColor(theme.gradient.stops[0]);
  const isMember = Boolean(activeMembership?.memberProfileId);

  return (
    <ScreenContainer>
      <GradientSurface slot="appHeaderBand" style={[styles.band, { borderRadius: theme.family.radii.card }]}>
        {activeMembership ? (
          <Text style={[styles.studio, fonts.bodyStrong, { color: onBand }]}>{activeMembership.studioName}</Text>
        ) : null}
        <Text style={[styles.name, fonts.display, { color: onBand }]}>
          Merhaba, {user?.firstName ?? ''}
        </Text>
      </GradientSurface>

      {isMember ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bu haftanın seanslarını gör"
          onPress={() => router.push('/(app)/seans')}
          style={[styles.link, { borderColor: colors.border, backgroundColor: colors.surface }]}
        >
          <Text style={[styles.linkTitle, fonts.bodyStrong, { color: colors.textPrimary }]}>Bu haftanın seansları</Text>
          <Text style={[styles.linkSubtitle, fonts.body, { color: colors.textSecondary }]}>
            Seans seçip yerinizi ayırın
          </Text>
        </Pressable>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  band: {
    padding: spacing[5],
    marginBottom: spacing[4],
  },
  studio: {
    fontSize: typography.size.sm,
    marginBottom: spacing[1],
    opacity: 0.9,
  },
  name: {
    fontSize: typography.size['2xl'],
  },
  link: {
    minHeight: 56,
    padding: spacing[4],
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
  },
  linkTitle: {
    fontSize: typography.size.md,
    marginBottom: 2,
  },
  linkSubtitle: {
    fontSize: typography.size.sm,
  },
});
