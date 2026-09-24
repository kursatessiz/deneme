import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { useSession } from '../../../src/lib/session';
import { radii, spacing, typography, useThemeColors } from '../../../src/theme';

interface MenuLinkProps {
  label: string;
  onPress: () => void;
}

function MenuLink({ label, onPress }: MenuLinkProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.menuRow, { borderColor: colors.border }]}
    >
      <Text style={[styles.menuLabel, { color: colors.textPrimary }]}>{label}</Text>
      <Text style={[styles.menuChevron, { color: colors.textMuted }]}>›</Text>
    </Pressable>
  );
}

export default function HesabimScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { user, memberships, activeMembership, signOut } = useSession();
  const canManageTheme = activeMembership?.permissions.includes('studio.settings.manage') ?? false;
  const canViewReports = activeMembership?.permissions.includes('reports.view') ?? false;
  const canViewLeads = activeMembership?.permissions.includes('leads.view') ?? false;
  const canManageAutomations = activeMembership?.permissions.includes('notifications.manage') ?? false;
  const canManagePartners = activeMembership?.permissions.includes('integrations.partners.manage') ?? false;
  const isMember = Boolean(activeMembership?.memberProfileId);
  const isTrainer = Boolean(activeMembership?.trainerProfileId);
  const canViewOwnCommission = isTrainer && (activeMembership?.permissions.includes('commissions.view.own') ?? false);
  const canViewPayroll = activeMembership?.permissions.includes('commissions.view.all') ?? false;
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
        <Text style={[styles.name, { color: colors.textPrimary }]}>
          {user?.firstName ?? ''} {user?.lastName ?? ''}
        </Text>
        <Text style={[styles.phone, { color: colors.textSecondary }]}>{user?.phone ?? ''}</Text>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Üyeliklerim</Text>
      <View style={[styles.membershipsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {memberships.map((membership) => (
          <View key={membership.id} style={styles.membershipRow}>
            <Text style={[styles.membershipStudio, { color: colors.textPrimary }]}>{membership.studioName}</Text>
            <Text style={[styles.membershipRole, { color: colors.textMuted }]}>{membership.roleName}</Text>
          </View>
        ))}
      </View>

      <View style={styles.menu}>
        <MenuLink label="Bildirim ayarları" onPress={() => router.push('/(app)/hesabim/bildirimler')} />
        <MenuLink label="Takvim aboneliği" onPress={() => router.push('/(app)/hesabim/takvim')} />
        <MenuLink label="PIN değiştir" onPress={() => router.push('/(app)/hesabim/pin')} />
        <MenuLink label="Görünüm" onPress={() => router.push('/(app)/hesabim/gorunum')} />
        {isMember ? <MenuLink label="Ana şubem" onPress={() => router.push('/(app)/hesabim/ana-sube')} /> : null}
        {isMember ? <MenuLink label="Ödemelerim" onPress={() => router.push('/(app)/hesabim/odemelerim')} /> : null}
        {isMember ? <MenuLink label="Başarılarım" onPress={() => router.push('/(app)/hesabim/basarilarim')} /> : null}
        {isMember ? <MenuLink label="Arkadaşını getir" onPress={() => router.push('/(app)/hesabim/arkadasini-getir')} /> : null}
        {canViewOwnCommission ? <MenuLink label="Hakedişim" onPress={() => router.push('/(app)/hesabim/hakedisim')} /> : null}
        {canViewPayroll ? <MenuLink label="Bordro" onPress={() => router.push('/(app)/hesabim/bordro')} /> : null}
        {isMember ? <MenuLink label="Faturalarım" onPress={() => router.push('/(app)/hesabim/faturalarim')} /> : null}
        {canViewReports ? <MenuLink label="Şube özeti" onPress={() => router.push('/(app)/hesabim/subeler')} /> : null}
        {canViewReports ? <MenuLink label="Raporlar" onPress={() => router.push('/(app)/hesabim/raporlar')} /> : null}
        {canViewReports ? (
          <MenuLink label="Riskli üyeler" onPress={() => router.push('/(app)/hesabim/riskli-uyeler')} />
        ) : null}
        {canViewLeads ? (
          <MenuLink label="Potansiyel üyeler" onPress={() => router.push('/(app)/hesabim/potansiyel-uyeler')} />
        ) : null}
        {canManageTheme ? (
          <MenuLink label="İşletme teması" onPress={() => router.push('/(app)/hesabim/isletme-temasi')} />
        ) : null}
        {canManageAutomations ? (
          <MenuLink label="Otomatik mesajlar" onPress={() => router.push('/(app)/hesabim/otomatik-mesajlar')} />
        ) : null}
        {canManagePartners ? (
          <MenuLink label="Partner platformlar" onPress={() => router.push('/(app)/hesabim/partner-platformlar')} />
        ) : null}
      </View>

      <PrimaryButton label="Çıkış yap" onPress={handleSignOut} loading={isSigningOut} variant="danger" />
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
    borderWidth: 1,
    borderRadius: radii.md,
    marginBottom: spacing[6],
    overflow: 'hidden',
  },
  membershipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minHeight: 44,
  },
  membershipStudio: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  membershipRole: {
    fontSize: typography.size.sm,
  },
  menu: {
    marginBottom: spacing[6],
  },
  menuRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  menuLabel: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  menuChevron: {
    fontSize: typography.size.lg,
  },
});
