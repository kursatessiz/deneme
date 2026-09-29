import { Stack } from 'expo-router';
import React from 'react';

import { useT } from '../../../src/i18n';

export default function VideolarLayout() {
  const t = useT();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t('mNav.tab.videos') }} />
    </Stack>
  );
}
