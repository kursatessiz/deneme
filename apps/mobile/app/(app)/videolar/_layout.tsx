import { Stack } from 'expo-router';
import React from 'react';

import { useT } from '../../../src/i18n';
import { useNavigationStyle } from '../../../src/navigation';

export default function VideolarLayout() {
  const t = useT();
  const navigation = useNavigationStyle();
  return (
    <Stack screenOptions={navigation.stack}>
      <Stack.Screen name="index" options={{ title: t('mNav.tab.videos') }} />
    </Stack>
  );
}
