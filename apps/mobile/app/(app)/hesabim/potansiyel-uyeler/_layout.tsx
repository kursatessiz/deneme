import { Stack } from 'expo-router';
import React from 'react';

export default function PotansiyelUyelerLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Potansiyel üyeler' }} />
      <Stack.Screen name="[leadId]" options={{ title: 'Potansiyel üye' }} />
    </Stack>
  );
}
