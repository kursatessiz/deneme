/** Pazarlama sigortaları (M3d): otomatik duraklatma nedenlerinin adları (pano, kampanya ekranı ve süper admin uyarıları). */
export const trMarketingGuards = {
  'marketingGuards.reason.BOUNCE': 'geri dönme (bounce)',
  'marketingGuards.reason.COMPLAINT': 'şikâyet',
  'marketingGuards.adCap.manual': 'Reklamlar otomatik durdurulmaz; kampanyaları reklam platformunda gözden geçirin.',
  'marketingGuards.adCap.paused.one': 'Otomatik duraklatma açıktı: {count} etkin kampanya duraklatıldı. Kampanyaları yalnızca siz sürdürebilirsiniz.',
  'marketingGuards.adCap.paused.other': 'Otomatik duraklatma açıktı: {count} etkin kampanya duraklatıldı. Kampanyaları yalnızca siz sürdürebilirsiniz.',
  'marketingGuards.adCap.nothingToPause': 'Otomatik duraklatma açık ancak duraklatılacak etkin kampanya bulunamadı.',
  'marketingGuards.adCap.failed': '{count} kampanya duraklatılamadı; reklam platformunda elle durdurun.',
  'marketingGuards.adCap.unsupported': '{platforms} için otomatik duraklatma desteklenmiyor; kampanyaları elle durdurun.',
  'marketingGuards.adCap.error': 'Otomatik duraklatma çalışırken hata oluştu; kampanyaları reklam platformunda elle kontrol edin.',
} as const satisfies Record<string, string>;
