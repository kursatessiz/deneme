/** Mobile app: Hesabım > Faturalarım (member invoice history). */
export const trMInvoices = {
  'mInvoices.status.draft': 'Hazırlanıyor',
  'mInvoices.status.issued': 'Kesildi',
  'mInvoices.status.cancelled': 'İptal edildi',
  'mInvoices.status.failed': 'Başarısız',
  'mInvoices.noInvoicesYet': 'Henüz bir faturanız bulunmuyor.',
  'mInvoices.viewInvoice': 'Faturayı görüntüle',
  'mInvoices.errors.loadFailed': 'Faturalar yüklenemedi.',
  'mInvoices.errors.noViewLinkYet': 'Bu fatura için görüntüleme bağlantısı sağlayıcı tarafından henüz sunulmuyor.',
  'mInvoices.errors.openFailed': 'Fatura açılamadı.',
} as const satisfies Record<string, string>;
