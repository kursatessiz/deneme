import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { onColor } from '@platform/shared';

import { GradientSurface } from '../../src/components/GradientSurface';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { useSession } from '../../src/lib/session';
import { spacing, typography, useTheme, useThemeFonts } from '../../src/theme';

export default function HomeScreen() {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const { user, activeMembership } = useSession();
  const onBand = onColor(theme.gradient.stops[0]);

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
});
