/** Super-admin Benchmark (Karşılaştırma) screen. */
export const trAdminBenchmark = {
  'adminBenchmark.title': 'Karşılaştırma (Benchmark)',
  'adminBenchmark.subtitle': 'İşletme türüne göre anonimleştirilmiş ortalamalar. En az 5 işletmesi olmayan gruplar gizlenir.',
  'adminBenchmark.accessDenied': 'Erişim yok',
  'adminBenchmark.studioCount': '{count} işletme',
  'adminBenchmark.suppressed': 'Yeterli işletme sayısı yok (en az 5 gerekli) - veriler gizlendi',
  'adminBenchmark.occupancy': 'Doluluk oranı: {value}',
  'adminBenchmark.cancellation': 'İptal oranı: {value}',
  'adminBenchmark.revenuePerMember': 'Üye başına gelir: {value}',
  'adminBenchmark.revenuePerMemberValue': '{amount} TL',
  'adminBenchmark.renewal': 'Yenileme oranı: {value}',
} as const satisfies Record<string, string>;
