import React from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PermissionKey } from '@platform/shared';

import { useSession } from '../lib/session';
import { spacing, typography, useThemeColors } from '../theme';
import { ScreenContainer } from './ScreenContainer';

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
  const { activeMembership } = useSession();
  const permissions = activeMembership?.permissions ?? [];
  const allowed = anyOf.length === 0 || anyOf.some((key) => permissions.includes(key));

  if (!allowed) {
    return (
      <ScreenContainer>
        <View style={styles.wrap}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Bu ekrana erişim yetkiniz yok</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Bu ekranı görüntülemek için gereken izne sahip değilsiniz. Gerekiyorsa işletme sahibinizden izin talep
            edin.
          </Text>
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
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    textAlign: 'center',
  },
  body: {
    fontSize: typography.size.sm,
    textAlign: 'center',
  },
});
