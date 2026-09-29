/** Public booking demo page (`/booking/[studioSlug]/book`). */
export const trBooking = {
  'booking.backToList': 'Stüdyo Listesine Dön',
  'booking.confirmed.title': 'Rezervasyon Onaylandı!',
  'booking.confirmed.summary': '{type} seansınız {date} günü saat {slot} için oluşturuldu. Kalan seansınızdan 1 kredi düşüldü.',
  'booking.confirmed.cancellationNote': 'Not: İptal işlemleri seans saatine en geç 4 saat kala ücretsiz olarak yapılabilir.',
  'booking.confirmed.newBooking': 'Yeni Bir Randevu Al',
  'booking.badge': 'Online Rezervasyon',
  'booking.intro': 'Lütfen seans türünü ve uygun saatinizi belirleyin',
  'booking.sessionType': 'Ders Türü',
  'booking.dateSelection': 'Tarih Seçimi',
  'booking.availableSlots': 'Müsait Seans Saatleri',
  'booking.confirm': 'Randevuyu Onayla',
} as const satisfies Record<string, string>;
