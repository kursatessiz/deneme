import { Stack } from 'expo-router';
import React from 'react';

export default function ProgramimLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Programım' }} />
      <Stack.Screen name="[scheduleId]" options={{ title: 'Seans detayı' }} />
      <Stack.Screen name="yeni" options={{ title: 'Yeni seans' }} />
    </Stack>
  );
}
