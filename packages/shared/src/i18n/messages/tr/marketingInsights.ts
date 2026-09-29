/** Haftalık pazarlama özeti (M3d): pano paneli ve e-posta gösterge etiketleri. */
export const trMarketingInsights = {
  'marketingInsights.title': 'Haftalık özet',
  'marketingInsights.subtitle': 'Her hafta bir kez, son tamamlanan haftanın toplu göstergelerinden hazırlanır.',
  'marketingInsights.loading': 'Yükleniyor',
  'marketingInsights.loadFailed': 'Haftalık özet yüklenemedi.',
  'marketingInsights.empty': 'Henüz haftalık özet yok. Süper admin, pazarlama ayarlarından haftalık özeti açtığında her pazartesi bir özet oluşur.',
  'marketingInsights.period': '{from} - {to}',
  'marketingInsights.earlier': 'Önceki haftalar',
  'marketingInsights.noData': 'Bu hafta özetlenecek yeterli veri yok.',
  'marketingInsights.hidden': 'En az {min} kişi olmadığı için gizlendi',

  'marketingInsights.actions.title': 'Önerilen eylemler',
  'marketingInsights.actions.basis': 'Dayanak: {metric}',

  'marketingInsights.metrics.title': 'Göstergeler',
  'marketingInsights.metrics.metric': 'Gösterge',
  'marketingInsights.metrics.thisWeek': 'Bu hafta',
  'marketingInsights.metrics.previousWeek': 'Önceki hafta',
  'marketingInsights.metrics.change': 'Değişim',

  'marketingInsights.metric.leads': 'Aday',
  'marketingInsights.metric.studioPaid': 'Ücretli işletme',
  'marketingInsights.metric.trials': 'Deneme başlatan',
  'marketingInsights.metric.converted': 'Ücretliye geçen',
  'marketingInsights.metric.trialRate': 'Deneme -> ücretli oranı',
  'marketingInsights.metric.spend': 'Reklam harcaması',
  'marketingInsights.metric.revenue': 'Getiri',
  'marketingInsights.metric.cac': 'Edinme maliyeti',
  'marketingInsights.metric.cpl': 'Aday başına maliyet',
  'marketingInsights.metric.roas': 'Reklam getirisi (ROAS)',
} as const satisfies Record<string, string>;
