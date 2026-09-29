/** Mobile app: Hesabım > Bildirim ayarları (push/SMS notification preferences per category). */
export const trMNotificationPrefs = {
  'mNotificationPrefs.pushDeniedBanner': 'Push bildirimlerine izin verilmemiş. Bildirim alabilmek için sistem ayarlarından izin verin.',
  'mNotificationPrefs.a11y.openSystemSettings': 'Sistem ayarlarını aç',
  'mNotificationPrefs.openSettings': 'Ayarları aç',
  'mNotificationPrefs.marketingNote': 'Bu bildirimler açık rızanız olmadan gönderilmez ve varsayılan olarak kapalıdır.',
  'mNotificationPrefs.push': 'Push',
  'mNotificationPrefs.sms': 'SMS',
  'mNotificationPrefs.errors.loadFailed': 'Bildirim ayarları yüklenemedi.',
  'mNotificationPrefs.errors.saveFailed': 'Değişiklik kaydedilemedi, tekrar deneyin.',
} as const satisfies Record<string, string>;
