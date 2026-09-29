import { Stack } from 'expo-router';
import React from 'react';

import { useT } from '../../../src/i18n';

export default function SeansLayout() {
  const t = useT();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t('mNav.tab.sessions') }} />
      <Stack.Screen name="[scheduleId]" options={{ title: t('mScreens.session') }} />
      <Stack.Screen name="degerlendir/[bookingId]" options={{ title: t('mScreens.rateSession') }} />
    </Stack>
  );
}
