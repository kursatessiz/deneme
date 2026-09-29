/** Marketing panel shell (/pazarlama/*): layout, navigation and the placeholder pages later phases fill (M1). */
export const trMarketing = {
  'marketing.layout.kicker': 'Platform pazarlaması',
  'marketing.layout.title': 'Pazarlama paneli',
  'marketing.layout.signedInAs': '{firstName} {lastName} olarak oturum açtınız',
  'marketing.layout.backToAdmin': 'Süper admin paneli',
  'marketing.layout.security': 'Güvenlik',
  'marketing.layout.contextFailed': 'Platform kiracısı yüklenemedi. Lütfen daha sonra tekrar deneyin.',

  'marketing.nav.dashboard': 'Pano',
  'marketing.nav.approvals': 'Onaylar',
  'marketing.nav.calendar': 'İçerik takvimi',
  'marketing.nav.aiStudio': 'Yapay zeka stüdyosu',
  'marketing.nav.contacts': 'Kişiler',
  'marketing.nav.segments': 'Segmentler',
  'marketing.nav.campaigns': 'Kampanyalar',
  'marketing.nav.journeys': 'Akışlar',
  'marketing.nav.inbox': 'Gelen kutusu',
  'marketing.nav.templates': 'Mesaj şablonları',
  'marketing.nav.site': 'Web sitesi',
  'marketing.nav.ads': 'Reklam',
  'marketing.nav.reports': 'Raporlar',
  'marketing.nav.integrations': 'Entegrasyonlar',
  'marketing.nav.brand': 'Marka kiti',

  'marketing.ads.performance': 'Performans',
  'marketing.ads.settings': 'Bağlantılar ve UTM',

  'marketing.placeholder.soon': 'Bu bölüm sonraki fazda eklenecek.',
  'marketing.placeholder.dashboard.title': 'Pazarlama panosu',
  'marketing.placeholder.dashboard.description': 'Huni, maliyet ve kanal sağlığı göstergeleri M3 fazında burada olacak. Şimdilik soldaki menüden kişilere, kampanyalara ve raporlara ulaşabilirsiniz.',
} as const satisfies Record<string, string>;
