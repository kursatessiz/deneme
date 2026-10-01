import React from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { PermissionKey } from '@platform/shared';

import { useT } from '../i18n';
import { useSession } from '../lib/session';
import { spacing, typography, useThemeColors, useThemeFonts } from '../theme';
import { ScreenContainer } from './ScreenContainer';
import { Text } from './Text';

interface PermissionGateProps {
  /** Screen renders only when the active membership holds at least one of these. */
  anyOf: PermissionKey[];
  children: ReactNode;
}

/**
 * Screen-level guard for staff-only screens (CLAUDE.md "Mobil uygulama
 * kuralları"). The API keeps enforcing the permission independently; this
 * only avoids showing a broken screen to someone whose menu entry
 * disappeared after a role change but who still has the route cached.
 */
export function PermissionGate({ anyOf, children }: PermissionGateProps) {
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const t = useT();
  const { activeMembership } = useSession();
  const permissions = activeMembership?.permissions ?? [];
  const allowed = anyOf.length === 0 || anyOf.some((key) => permissions.includes(key));

  if (!allowed) {
    return (
      <ScreenContainer>
        <View style={styles.wrap}>
          <Text style={[styles.title, fonts.display, { color: colors.textPrimary }]}>{t('mAccount.permissionGate.title')}</Text>
          <Text style={[styles.body, fonts.body, { color: colors.textSecondary }]}>{t('mAccount.permissionGate.body')}</Text>
        </View>
      </ScreenContainer>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: spacing[10],
    alignItems: 'center',
    gap: spacing[2],
  },
  title: {
    fontSize: typography.size.md,
    textAlign: 'center',
  },
  body: {
    fontSize: typography.size.sm,
    textAlign: 'center',
  },
});
