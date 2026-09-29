import { Stack } from 'expo-router';
import React from 'react';

import { useT } from '../../../../src/i18n';

export default function PotansiyelUyelerLayout() {
  const t = useT();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t('mScreens.potentialMembers') }} />
      <Stack.Screen name="[leadId]" options={{ title: t('mScreens.potentialMember') }} />
    </Stack>
  );
}
