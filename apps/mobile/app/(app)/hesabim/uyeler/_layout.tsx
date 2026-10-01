import { Stack } from 'expo-router';
import React from 'react';

import { useT } from '../../../../src/i18n';
import { useNavigationStyle } from '../../../../src/navigation';

export default function UyelerLayout() {
  const t = useT();
  const navigation = useNavigationStyle();
  return (
    <Stack screenOptions={navigation.stack}>
      <Stack.Screen name="index" options={{ title: t('mScreens.members') }} />
      <Stack.Screen name="[memberId]" options={{ title: t('mScreens.memberCard') }} />
      <Stack.Screen name="yeni" options={{ title: t('mScreens.inviteNewMember') }} />
      <Stack.Screen name="walk-in" options={{ title: t('mScreens.addToSession') }} />
      <Stack.Screen name="paket-sat" options={{ title: t('mScreens.sellPackage') }} />
    </Stack>
  );
}
