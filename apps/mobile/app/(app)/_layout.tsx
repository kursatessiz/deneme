import { Redirect, Tabs } from 'expo-router';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { contrastRatio } from '@platform/shared';

import { useSession } from '../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors } from '../../src/theme';

function StudioSwitcher() {
  const colors = useThemeColors();
  const { memberships, activeStudioId, setActiveStudioId } = useSession();
  const [isOpen, setIsOpen] = useState(false);

  const activeMembership = memberships.find((m) => m.studioId === activeStudioId);

  if (memberships.length <= 1) {
    return (
      <View style={styles.badge}>
        <Text style={[styles.badgeText, { color: colors.textPrimary }]}>{activeMembership?.studioName ?? ''}</Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stüdyo seç"
        onPress={() => setIsOpen(true)}
        style={styles.badge}
      >
        <Text style={[styles.badgeText, { color: colors.textPrimary }]}>{activeMembership?.studioName ?? 'Stüdyo seç'} v</Text>
      </Pressable>
      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setIsOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            {memberships.map((membership) => (
              <Pressable
                key={membership.studioId}
                accessibilityRole="button"
                accessibilityLabel={membership.studioName}
                style={styles.sheetRow}
                onPress={() => {
                  setActiveStudioId(membership.studioId);
                  setIsOpen(false);
                }}
              >
                <Text style={[styles.sheetRowText, { color: colors.textPrimary }]}>{membership.studioName}</Text>
                {membership.studioId === activeStudioId ? <Text style={styles.checkmark}>Seçili</Text> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export default function AppLayout() {
  const { user, isLoading } = useSession();
  const colors = useThemeColors();

  if (!isLoading && !user) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerRight: () => <StudioSwitcher />,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.textPrimary },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        // A pale brand color would vanish on the tab bar; fall back to text color.
        tabBarActiveTintColor: contrastRatio(colors.primary, colors.surface) >= 3 ? colors.primary : colors.textPrimary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Ana sayfa' }} />
      <Tabs.Screen name="seans" options={{ title: 'Seanslar', headerShown: false }} />
      <Tabs.Screen name="hesabim" options={{ title: 'Hesabım', headerShown: false }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    marginRight: spacing[4],
    minHeight: 44,
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(20, 18, 15, 0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    padding: spacing[4],
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
  },
  sheetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: spacing[2],
  },
  sheetRowText: {
    fontSize: typography.size.md,
  },
  checkmark: {
    color: palette.success,
    fontWeight: typography.weight.bold,
  },
});
