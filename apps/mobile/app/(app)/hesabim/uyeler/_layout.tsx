import { Stack } from 'expo-router';
import React from 'react';

export default function UyelerLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Üyeler' }} />
      <Stack.Screen name="[memberId]" options={{ title: 'Üye kartı' }} />
      <Stack.Screen name="yeni" options={{ title: 'Yeni üye davet et' }} />
      <Stack.Screen name="walk-in" options={{ title: 'Seansa ekle' }} />
      <Stack.Screen name="paket-sat" options={{ title: 'Paket sat' }} />
    </Stack>
  );
}
