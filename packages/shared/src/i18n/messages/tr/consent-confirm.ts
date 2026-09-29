/** Public double opt-in confirmation page (/onay/[token], M3e). */
export const trConsentConfirm = {
  'consentConfirm.title': 'Aboneliğinizi onaylayın',
  'consentConfirm.description': 'Formda haber ve tekliflerimizi almak istediğinizi belirttiniz. Onaylamak için aşağıdaki düğmeye basın.',
  'consentConfirm.confirm': 'Aboneliği onayla',
  'consentConfirm.done': 'Teşekkürler, aboneliğiniz onaylandı. İstediğiniz zaman her mesajdaki bağlantıdan çıkabilirsiniz.',
  'consentConfirm.invalid': 'Bu bağlantı geçersiz, süresi dolmuş veya daha önce kullanılmış. Gerekirse formu yeniden doldurabilirsiniz.',
  'consentConfirm.error': 'Şu anda onaylanamadı, lütfen biraz sonra tekrar deneyin.',
  'consentConfirm.note': 'Onay sırasında yalnızca zaman ve form sürümü saklanır; IP adresiniz kaydedilmez.',
} as const satisfies Record<string, string>;
