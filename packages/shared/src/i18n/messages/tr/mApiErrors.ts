/** Mobile app: generic network/API error fallbacks thrown by the fetch wrapper (apiRequest, kioskRequest). */
export const trMApiErrors = {
  'mApiErrors.networkUnreachable': 'Sunucuya bağlanılamadı. Bağlantınızı kontrol edip tekrar deneyin.',
  'mApiErrors.sessionExpired': 'Oturum süresi doldu, lütfen tekrar giriş yapın.',
  'mApiErrors.tooManyAttempts': 'Çok fazla deneme yapıldı. Lütfen bir süre sonra tekrar deneyin.',
  'mApiErrors.unexpectedError': 'Beklenmeyen bir hata oluştu.',
  'mApiErrors.kioskNotPaired': 'Bu cihaz eşleştirilmemiş',
} as const satisfies Record<string, string>;
