/** Mobile app: reception walk-in booking screen (add a member to a session from the member card). */
export const trMWalkIn = {
  'mWalkIn.bookingCreated': 'Rezervasyon oluşturuldu',
  'mWalkIn.backToMemberCard': 'Üye kartına dön',
  'mWalkIn.title': 'Seansa ekle (walk-in)',
  'mWalkIn.lead': 'Önümüzdeki 7 gün, boş kontenjanı olan seanslar',
  'mWalkIn.noAvailableSessions': 'Uygun seans bulunamadı.',
  'mWalkIn.add': 'Ekle',
  'mWalkIn.errors.sessionsLoadFailed': 'Seanslar yüklenemedi.',
  'mWalkIn.errors.bookingFailed': 'Rezervasyon yapılamadı.',
  'mWalkIn.noticeTitle': 'Bilgi',
  'mWalkIn.repeatOverride.title': 'Asgari gün kuralı',
  'mWalkIn.repeatOverride.body.one': 'Bu üye için en az {count} gün kuralı ihlal ediliyor (son seans: {date}). Yine de rezervasyon yapılsın mı?',
  'mWalkIn.repeatOverride.body.other': 'Bu üye için en az {count} gün kuralı ihlal ediliyor (son seans: {date}). Yine de rezervasyon yapılsın mı?',
  'mWalkIn.repeatOverride.confirm': 'Yine de ekle',
  'mWalkIn.repeatOverride.cancel': 'Vazgeç',
} as const satisfies Record<string, string>;
