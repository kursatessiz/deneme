import { Stack } from 'expo-router';
import React from 'react';

import { useT } from '../../../../src/i18n';
import { useNavigationStyle } from '../../../../src/navigation';

export default function PotansiyelUyelerLayout() {
  const t = useT();
  const navigation = useNavigationStyle();
  return (
    <Stack screenOptions={navigation.stack}>
      <Stack.Screen name="index" options={{ title: t('mScreens.potentialMembers') }} />
      <Stack.Screen name="[leadId]" options={{ title: t('mScreens.potentialMember') }} />
    </Stack>
  );
}
