import { Stack } from 'expo-router';
import React from 'react';

export default function HesabimLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Hesabım' }} />
      <Stack.Screen name="bildirimler" options={{ title: 'Bildirim ayarları' }} />
      <Stack.Screen name="pin" options={{ title: 'PIN değiştir' }} />
    </Stack>
  );
}
