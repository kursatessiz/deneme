import { Stack } from 'expo-router';
import React from 'react';

export default function SeansLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Seanslar' }} />
      <Stack.Screen name="[scheduleId]" options={{ title: 'Seans' }} />
    </Stack>
  );
}
