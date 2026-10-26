import React from 'react';
import { StyleSheet, View } from 'react-native';

import { EntitlementKind, onGradient, usageQuotaNoun } from '@platform/shared';
import type { MemberPackageDTO } from '@platform/shared';

import { GradientSurface } from './GradientSurface';
import { useLocale, useT } from '../i18n';
import { radii, spacing, typography, useTheme, useThemeFonts } from '../theme';
import type { Translate } from '@platform/shared';
import { Text } from './Text';
import { withAlpha } from './tones';
import { packageUsageLines } from '../lib/usagePeriodLines';

function entitlementLabel(pkg: MemberPackageDTO, t: Translate): string {
  if (pkg.entitlementKind === EntitlementKind.TIME_UNLIMITED) return t('mPackageCard.unlimitedDuration');
  const remaining = pkg.remainingUnits ?? 0;
  const total = pkg.totalUnits ?? remaining;
  return pkg.entitlementKind === EntitlementKind.CREDIT
    ? t('mPackageCard.creditsRemaining', { remaining, total })
    : t('mPackageCard.sessionsRemaining', { remaining, total });
}

function statusLabels(t: Translate): Record<string, string> {
  return {
    ACTIVE: t('mPackageCard.status.active'),
    FROZEN: t('mPackageCard.status.frozen'),
    EXPIRED: t('mPackageCard.status.expired'),
    DEPLETED: t('mPackageCard.status.depleted'),
  };
}

/** Active-package card: the tenant gradient (CLAUDE.md design rule 10, packageCard slot; brand gradient of the tenant primary). */
export function PackageCard({ pkg }: { pkg: MemberPackageDTO }) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const { locale } = useLocale();
  const t = useT();
  const STATUS_LABEL = statusLabels(t);
  const textColor = onGradient(theme.gradient);
  const usageLines = packageUsageLines(pkg, t, locale);

  return (
    <GradientSurface slot="packageCard" style={[styles.card, { borderRadius: radii.md }]}>
      <Text style={[styles.name, fonts.bodyStrong, { color: textColor }]} numberOfLines={1}>
        {pkg.packageDefinitionName}
      </Text>
      <Text style={[styles.entitlement, fonts.body, { color: textColor }]}>{entitlementLabel(pkg, t)}</Text>
      {usageLines.map((line) => (
        <View key={line.unit} style={styles.usageLine}>
          <View style={styles.usageRow}>
            <Text style={[styles.usageText, fonts.body, { color: textColor }]}>{line.text}</Text>
            <View
              style={[
                styles.usageBadge,
                { borderColor: textColor, borderRadius: radii.full, backgroundColor: line.burns ? withAlpha(textColor, 0.2) : 'transparent' },
              ]}
            >
              <Text style={[styles.usageBadgeText, fonts.bodyMedium, { color: textColor }]}>{line.badge}</Text>
            </View>
          </View>
          {line.hint ? <Text style={[styles.usageText, fonts.bodyStrong, { color: textColor }]}>{line.hint}</Text> : null}
        </View>
      ))}
      {usageLines.length > 0 && (pkg.expiredUnits ?? 0) > 0 ? (
        <Text style={[styles.usageText, fonts.body, { color: textColor }]}>
          {t('usagePeriods.expired.total', { units: usageQuotaNoun(t, pkg.entitlementKind, pkg.expiredUnits ?? 0) })}
        </Text>
      ) : null}
      <View style={styles.footer}>
        <Text style={[styles.status, fonts.body, { color: textColor }]}>{STATUS_LABEL[pkg.status] ?? pkg.status}</Text>
        <Text style={[styles.status, fonts.body, { color: textColor }]}>
          {t('mPackageCard.endDate', { date: new Date(pkg.endDate).toLocaleDateString(locale) })}
        </Text>
      </View>
      {pkg.frozenUntil ? (
        <Text style={[styles.status, fonts.body, { color: textColor }]}>
          {t('mPackageCard.frozenUntil', { date: new Date(pkg.frozenUntil).toLocaleDateString(locale) })}
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
  usageLine: { gap: spacing[1] },
  usageRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2] },
  usageText: { fontSize: typography.size.xs },
  usageBadge: { borderWidth: 1, paddingHorizontal: spacing[2], paddingVertical: spacing[1] / 2 },
  usageBadgeText: { fontSize: typography.size.xs },
});
