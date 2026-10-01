import { Redirect, Tabs } from 'expo-router';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { useT } from '../../src/i18n';
import { useSession } from '../../src/lib/session';
import { useNavigationStyle } from '../../src/navigation';
import { SCRIM, TOUCH_TARGET, borderWidth, radii, spacing, typography, useThemeColors, useThemeFonts } from '../../src/theme';
import { Text } from '../../src/components/Text';

function StudioSwitcher() {
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const accent = useNavigationStyle().accent;
  const t = useT();
  const { memberships, activeStudioId, setActiveStudioId } = useSession();
  const [isOpen, setIsOpen] = useState(false);

  const activeMembership = memberships.find((m) => m.studioId === activeStudioId);

  if (memberships.length <= 1) {
    return (
      <View style={styles.badge}>
        <Text style={[styles.badgeText, fonts.bodyMedium, { color: colors.textPrimary }]}>{activeMembership?.studioName ?? ''}</Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('mNav.studioSwitcher.select')}
        onPress={() => setIsOpen(true)}
        style={styles.badge}
      >
        <Text style={[styles.badgeText, fonts.bodyMedium, { color: colors.textPrimary }]}>
          {activeMembership?.studioName ?? t('mNav.studioSwitcher.select')} v
        </Text>
      </Pressable>
      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setIsOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
                <Text style={[styles.sheetRowText, fonts.body, { color: colors.textPrimary }]}>{membership.studioName}</Text>
                {membership.studioId === activeStudioId ? (
                  <Text style={[styles.checkmark, fonts.bodyStrong, { color: accent }]}>{t('mNav.studioSwitcher.selected')}</Text>
                ) : null}
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
  const navigation = useNavigationStyle();
  const t = useT();

  if (!isLoading && !user) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerRight: () => <StudioSwitcher />,
        // A pale brand color would vanish on the tab bar; the navigation style falls back to the text color.
        ...navigation.tabs,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('mNav.tab.home') }} />
      <Tabs.Screen name="seans" options={{ title: t('mNav.tab.sessions'), headerShown: false }} />
      <Tabs.Screen name="videolar" options={{ title: t('mNav.tab.videos'), headerShown: false }} />
      <Tabs.Screen name="hesabim" options={{ title: t('mNav.tab.account'), headerShown: false }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    marginRight: spacing[4],
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: typography.size.sm,
  },
  overlay: {
    flex: 1,
    backgroundColor: SCRIM,
    justifyContent: 'flex-end',
  },
  sheet: {
    padding: spacing[4],
    borderTopLeftRadius: radii.md,
    borderTopRightRadius: radii.md,
    borderWidth: borderWidth,
  },
  sheetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: TOUCH_TARGET,
    paddingVertical: spacing[2],
  },
  sheetRowText: {
    fontSize: typography.size.md,
  },
  checkmark: {
    fontSize: typography.size.sm,
  },
});
