import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card } from '../../../src/components/Card';
import { ListRow } from '../../../src/components/ListRow';

import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { useT } from '../../../src/i18n';
import { usePlatformAccess } from '../../../src/lib/platformContext';
import { buildHesabimMenu } from '../../../src/lib/staffMenu';
import { useSession } from '../../../src/lib/session';
import { spacing, typography, useThemeColors, useThemeFonts } from '../../../src/theme';
import { Text } from '../../../src/components/Text';

export default function HesabimScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const t = useT();
  const { user, memberships, activeMembership, signOut } = useSession();
  const isMember = Boolean(activeMembership?.memberProfileId);
  const isTrainer = Boolean(activeMembership?.trainerProfileId);
  const platform = usePlatformAccess(user?.isSuperAdmin ?? false);
  const menu = buildHesabimMenu({
    permissions: activeMembership?.permissions ?? [],
    isMember,
    isTrainer,
    platformPermissions: platform.permissions,
  });
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      router.replace('/(auth)/login');
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={styles.profile}>
        <Text style={[styles.name, fonts.display, { color: colors.textPrimary }]}>
          {user?.firstName ?? ''} {user?.lastName ?? ''}
        </Text>
        <Text style={[styles.phone, fonts.body, { color: colors.textSecondary }]}>{user?.phone ?? ''}</Text>
      </View>

      <Text style={[styles.sectionTitle, fonts.bodyMedium, { color: colors.textSecondary }]}>{t('mAccount.memberships.title')}</Text>
      <Card flush style={styles.membershipsCard}>
        <View style={styles.cardRows}>
          {memberships.map((membership, index) => (
            <ListRow
              key={membership.id}
              title={membership.studioName}
              trailing={<Text style={[styles.membershipRole, fonts.body, { color: colors.textMuted }]}>{membership.roleName}</Text>}
              divider={index < memberships.length - 1}
            />
          ))}
        </View>
      </Card>

      <Card flush style={styles.menu}>
        <View style={styles.cardRows}>
          {menu.map((item, index) => (
            <ListRow
              key={item.key}
              title={t(item.labelKey)}
              onPress={() => router.push(item.route as never)}
              trailing={<Text style={[styles.menuChevron, fonts.body, { color: colors.textMuted }]}>›</Text>}
              divider={index < menu.length - 1}
            />
          ))}
        </View>
      </Card>

      <PrimaryButton label={t('mAccount.signOut')} onPress={handleSignOut} loading={isSigningOut} variant="danger" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  profile: {
    marginBottom: spacing[6],
  },
  name: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginBottom: spacing[1],
  },
  phone: {
    fontSize: typography.size.sm,
  },
  sectionTitle: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    marginBottom: spacing[2],
  },
  membershipsCard: {
    marginBottom: spacing[6],
  },
  cardRows: {
    paddingHorizontal: spacing[4],
  },
  membershipRole: {
    fontSize: typography.size.sm,
  },
  menu: {
    marginBottom: spacing[6],
  },
  menuChevron: {
    fontSize: typography.size.lg,
  },
});
