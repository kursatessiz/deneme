import { Stack } from 'expo-router';
import React from 'react';

import { useT } from '../../../src/i18n';

export default function HesabimLayout() {
  const t = useT();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t('mNav.tab.account') }} />
      <Stack.Screen name="bildirimler" options={{ title: t('mAccount.menu.notifications') }} />
      <Stack.Screen name="takvim" options={{ title: t('mAccount.menu.calendarSub') }} />
      <Stack.Screen name="pin" options={{ title: t('mAccount.menu.pin') }} />
      <Stack.Screen name="gorunum" options={{ title: t('mAccount.menu.appearance') }} />
      <Stack.Screen name="odemelerim" options={{ title: t('mAccount.menu.myPayments') }} />
      <Stack.Screen name="faturalarim" options={{ title: t('mAccount.menu.myInvoices') }} />
      <Stack.Screen name="isletme-temasi" options={{ title: t('mAccount.menu.businessTheme') }} />
      <Stack.Screen name="ana-sube" options={{ title: t('mAccount.menu.homeBranch') }} />
      <Stack.Screen name="subeler" options={{ title: t('mAccount.menu.branchSummary') }} />
      <Stack.Screen name="raporlar" options={{ title: t('mAccount.menu.reports') }} />
      <Stack.Screen name="hakedisim" options={{ title: t('mAccount.menu.myCommission') }} />
      <Stack.Screen name="bordro" options={{ title: t('mAccount.menu.payroll') }} />
      <Stack.Screen name="potansiyel-uyeler" options={{ title: t('mScreens.potentialMembers'), headerShown: false }} />
      <Stack.Screen name="otomatik-mesajlar" options={{ title: t('mAccount.menu.automations') }} />
      <Stack.Screen name="riskli-uyeler" options={{ title: t('mAccount.menu.riskyMembers') }} />
      <Stack.Screen name="arkadasini-getir" options={{ title: t('mAccount.menu.referFriend') }} />
      <Stack.Screen name="entegrasyonlar" options={{ title: t('mAccount.menu.integrations') }} />
      <Stack.Screen name="partner-platformlar" options={{ title: t('mAccount.menu.partners') }} />
      <Stack.Screen name="saglik" options={{ title: t('mAccount.menu.health') }} />
      <Stack.Screen name="saglik-ozet" options={{ title: t('mScreens.healthSummary') }} />
      <Stack.Screen name="video-icerikleri" options={{ title: t('mAccount.menu.videoContent') }} />
      <Stack.Screen name="mesajlar" options={{ title: t('mMessaging.chat.title') }} />
      <Stack.Screen name="gelen-kutusu" options={{ title: t('mMessaging.inbox.title') }} />
      <Stack.Screen name="kisiler" options={{ title: t('mAccount.menu.contacts') }} />
      <Stack.Screen name="puanlarim" options={{ title: t('mLoyalty.title') }} />
      <Stack.Screen name="etkinlikler" options={{ title: t('mEvents.title') }} />
      <Stack.Screen name="topluluk" options={{ title: t('mCommunity.title') }} />
      <Stack.Screen name="etkinlik" options={{ title: t('mEvents.title') }} />
      <Stack.Screen name="etkinlik-girisi" options={{ title: t('mEvents.checkin.title') }} />
      <Stack.Screen name="hizli-satis" options={{ title: t('mRetail.title') }} />
    </Stack>
  );
}
