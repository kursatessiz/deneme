/** Mobile app: root error screen (H2 error reporting, docs/HATA_RAPORLAMA.md). */
export const trMErrors = {
  'mErrors.boundary.title': 'Bir şeyler ters gitti',
  'mErrors.boundary.description': 'Uygulama beklenmedik bir hatayla karşılaştı. Hata kaydedildi; tekrar deneyebilirsiniz.',
  'mErrors.boundary.code': 'Hata kodu: {code}',
  'mErrors.boundary.codeHint': 'Destek ekibiyle iletişime geçerseniz bu kodu paylaşın.',
  'mErrors.boundary.retry': 'Tekrar dene',
  'mErrors.feedback.label': 'Ne yapıyordunuz? (isteğe bağlı)',
  'mErrors.feedback.placeholder': 'Hatayı görmeden önce ne yaptığınızı kısaca yazın. E-posta veya telefon yazmayın.',
  'mErrors.feedback.counter': '{count} / {max}',
  'mErrors.feedback.submit': 'Gönder',
  'mErrors.feedback.sent': 'Teşekkürler, notunuz iletildi.',
  'mErrors.feedback.failed': 'Notunuz iletilemedi. Biraz sonra tekrar deneyebilirsiniz.',
} as const satisfies Record<string, string>;
