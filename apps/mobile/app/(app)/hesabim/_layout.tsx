import { Stack } from 'expo-router';
import React from 'react';

export default function HesabimLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Hesabım' }} />
      <Stack.Screen name="bildirimler" options={{ title: 'Bildirim ayarları' }} />
      <Stack.Screen name="takvim" options={{ title: 'Takvim aboneliği' }} />
      <Stack.Screen name="pin" options={{ title: 'PIN değiştir' }} />
      <Stack.Screen name="gorunum" options={{ title: 'Görünüm' }} />
      <Stack.Screen name="odemelerim" options={{ title: 'Ödemelerim' }} />
      <Stack.Screen name="faturalarim" options={{ title: 'Faturalarım' }} />
      <Stack.Screen name="isletme-temasi" options={{ title: 'İşletme teması' }} />
      <Stack.Screen name="ana-sube" options={{ title: 'Ana şubem' }} />
      <Stack.Screen name="subeler" options={{ title: 'Şube özeti' }} />
      <Stack.Screen name="raporlar" options={{ title: 'Raporlar' }} />
      <Stack.Screen name="hakedisim" options={{ title: 'Hakedişim' }} />
      <Stack.Screen name="bordro" options={{ title: 'Bordro' }} />
      <Stack.Screen name="potansiyel-uyeler" options={{ title: 'Potansiyel üyeler', headerShown: false }} />
      <Stack.Screen name="otomatik-mesajlar" options={{ title: 'Otomatik mesajlar' }} />
      <Stack.Screen name="riskli-uyeler" options={{ title: 'Riskli üyeler' }} />
      <Stack.Screen name="arkadasini-getir" options={{ title: 'Arkadaşını getir' }} />
      <Stack.Screen name="entegrasyonlar" options={{ title: 'Entegrasyonlar' }} />
      <Stack.Screen name="partner-platformlar" options={{ title: 'Partner platformlar' }} />
    </Stack>
  );
}
