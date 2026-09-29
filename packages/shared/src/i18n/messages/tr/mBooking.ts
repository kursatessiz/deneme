/** Mobile app: booking status labels shared by the member card, session detail and roster screens. */
export const trMBooking = {
  'mBooking.status.confirmed': 'Onaylı',
  'mBooking.status.attended': 'Katıldı',
  'mBooking.status.cancelledEarly': 'İptal',
  'mBooking.status.cancelledLate': 'Geç iptal',
  'mBooking.status.noShow': 'Gelmedi',
  'mBooking.status.waitlist': 'Bekleme listesi',
  'mBooking.genericMember': 'Üye',
} as const satisfies Record<string, string>;
