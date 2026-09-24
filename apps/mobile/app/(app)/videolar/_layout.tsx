import { Stack } from 'expo-router';
import React from 'react';

export default function VideolarLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Videolar' }} />
    </Stack>
  );
}
