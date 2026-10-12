/** Mobil uygulama: Hesabım > Gizlilik (kişisel verilerimin silinmesini talep et), docs/KVKK_SILME.md. */
export const trMErasure = {
  'mErasure.title': 'Gizlilik',
  'mErasure.lead':
    'KVKK ve GDPR kapsamında bu işletmedeki kişisel verilerinizin silinmesini isteyebilirsiniz. İşletme talebinizi inceler; ödeme, fatura ve rezervasyon kayıtları yasal saklama gereği kimliğinizi göstermeden korunur. Talep işlenmezse en geç 30 gün içinde otomatik işlenir.',
  'mErasure.request.action': 'Verilerimin silinmesini talep et',
  'mErasure.request.confirm': 'Bu işletmedeki kişisel verileriniz anonimleştirilecek ve bu işletmedeki hesabınıza erişiminiz kapanacak. Bu işlem geri alınamaz. Talep gönderilsin mi?',
  'mErasure.request.confirmYes': 'Talebi gönder',
  'mErasure.request.cancel': 'Vazgeç',
  'mErasure.request.sent': 'Talebiniz alındı.',
  'mErasure.status.title': 'Talep durumu',
  'mErasure.status.PENDING': 'Talebiniz inceleniyor. Son işlem tarihi: {date}.',
  'mErasure.status.APPROVED': 'Talebiniz onaylandı ve kısa süre içinde işlenecek.',
  'mErasure.status.REJECTED': 'Talebiniz reddedildi.',
  'mErasure.status.COMPLETED': 'Kişisel verileriniz anonimleştirildi.',
  'mErasure.status.reason': 'Gerekçe: {reason}',
  'mErasure.errors.loadFailed': 'Talep durumu yüklenemedi.',
  'mErasure.errors.requestFailed': 'Talep gönderilemedi.',
} as const;
