import { Stack } from 'expo-router';
import React from 'react';

import { useT } from '../../../../src/i18n';
import { useNavigationStyle } from '../../../../src/navigation';

export default function ProgramimLayout() {
  const t = useT();
  const navigation = useNavigationStyle();
  return (
    <Stack screenOptions={navigation.stack}>
      <Stack.Screen name="index" options={{ title: t('mScreens.mySchedule') }} />
      <Stack.Screen name="[scheduleId]" options={{ title: t('mScreens.sessionDetail') }} />
      <Stack.Screen name="yeni" options={{ title: t('mScreens.newSession') }} />
    </Stack>
  );
}
