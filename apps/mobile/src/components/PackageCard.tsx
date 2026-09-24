import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EntitlementKind, onColor } from '@platform/shared';
import type { MemberPackageDTO } from '@platform/shared';

import { GradientSurface } from './GradientSurface';
import { spacing, typography, useTheme, useThemeFonts } from '../theme';

function entitlementLabel(pkg: MemberPackageDTO): string {
  if (pkg.entitlementKind === EntitlementKind.TIME_UNLIMITED) return 'Süre sınırsız';
  const remaining = pkg.remainingUnits ?? 0;
  const total = pkg.totalUnits ?? remaining;
  return pkg.entitlementKind === EntitlementKind.CREDIT
    ? `${remaining}/${total} kredi kaldı`
    : `${remaining}/${total} seans kaldı`;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Aktif',
  FROZEN: 'Donduruldu',
  EXPIRED: 'Süresi doldu',
  DEPLETED: 'Tükendi',
};

/** Active-package card: the tenant gradient (CLAUDE.md design rule 10, packageCard slot). */
export function PackageCard({ pkg }: { pkg: MemberPackageDTO }) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const textColor = onColor(theme.gradient.stops[0]);

  return (
    <GradientSurface slot="packageCard" style={[styles.card, { borderRadius: theme.family.radii.card }]}>
      <Text style={[styles.name, fonts.bodyStrong, { color: textColor }]} numberOfLines={1}>
        {pkg.packageDefinitionName}
      </Text>
      <Text style={[styles.entitlement, fonts.body, { color: textColor }]}>{entitlementLabel(pkg)}</Text>
      <View style={styles.footer}>
        <Text style={[styles.status, fonts.body, { color: textColor }]}>{STATUS_LABEL[pkg.status] ?? pkg.status}</Text>
        <Text style={[styles.status, fonts.body, { color: textColor }]}>
          Bitiş: {new Date(pkg.endDate).toLocaleDateString('tr-TR')}
        </Text>
      </View>
      {pkg.frozenUntil ? (
        <Text style={[styles.status, fonts.body, { color: textColor }]}>
          Dondurma bitiş: {new Date(pkg.frozenUntil).toLocaleDateString('tr-TR')}
        </Text>
      ) : null}
    </GradientSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing[4],
    marginBottom: spacing[3],
    gap: spacing[1],
  },
  name: { fontSize: typography.size.md },
  entitlement: { fontSize: typography.size.sm },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing[2] },
  status: { fontSize: typography.size.xs },
});
