/** Mobile app: Hesabım > Otomatik mesajlar (automation rules on/off, last-30-day stats). */
export const trMAutomations = {
  'mAutomations.type.winBack': 'Kayıp üye kazanma',
  'mAutomations.type.packageExpiring': 'Paket bitiş hatırlatması',
  'mAutomations.type.birthday': 'Doğum günü mesajı',
  'mAutomations.type.firstClassFollowUp': 'İlk seans sonrası geri bildirim',
  'mAutomations.type.bookingReminder': 'Seans hatırlatması',
  'mAutomations.type.noShowFollowUp': 'Gelmeme sonrası hatırlatma',
  'mAutomations.intro':
    'Otomatik mesajlar üyelere belirli koşullarda gönderilir. Pazarlama amaçlı mesajlar (kayıp üye kazanma, doğum günü) yalnızca açık rızası olan üyelere gönderilir.',
  'mAutomations.marketingSuffix': ' · Pazarlama (onay gerektirir)',
  'mAutomations.activeLabel': '{name} aktif',
  'mAutomations.last30Days': 'Son 30 gün:',
  'mAutomations.sentCount': '{count} gönderildi',
  'mAutomations.skippedCount': '{count} atlandı',
  'mAutomations.failedCount': '{count} başarısız',
  'mAutomations.errors.loadFailed': 'Otomasyon kuralları yüklenemedi.',
  'mAutomations.errors.toggleFailed': 'Değişiklik kaydedilemedi, tekrar deneyin.',
} as const satisfies Record<string, string>;
