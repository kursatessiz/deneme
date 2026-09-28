/**
 * Built-in message templates (G1c, docs/MESAJLASMA.md). `text` is the SMS,
 * WhatsApp, push and in-app body and the email paragraph; `subject` is the
 * email subject and the push/in-app title. Placeholders use `{name}`.
 * These are seeded as global templates in every bundled language.
 */
export const trMsgTpl = {
  'msgTpl.BOOKING_REMINDER.subject': 'Seans hatırlatması',
  'msgTpl.BOOKING_REMINDER.text': 'Merhaba {firstName}, {serviceName} seansınız {startTime} saatinde başlayacak.',
  'msgTpl.BOOKING_CANCELLED_BY_STUDIO.subject': 'Seansınız iptal edildi',
  'msgTpl.BOOKING_CANCELLED_BY_STUDIO.text': 'Merhaba {firstName}, {startTime} saatindeki {serviceName} seansınız işletme tarafından iptal edildi.',
  'msgTpl.WAITLIST_PROMOTED.subject': 'Bekleme listesinden yer açıldı',
  'msgTpl.WAITLIST_PROMOTED.text': 'Merhaba {firstName}, bekleme listesinde olduğunuz {serviceName} seansında yer açıldı, rezervasyonunuz onaylandı.',
  'msgTpl.PACKAGE_EXPIRING.subject': 'Paketinizin süresi doluyor',
  'msgTpl.PACKAGE_EXPIRING.text': 'Merhaba {firstName}, {packageName} paketinizdeki {remainingUnits} hakkınızın son kullanım tarihi {expiryDate}.',
  'msgTpl.PAYMENT_FAILED.subject': 'Ödemeniz alınamadı',
  'msgTpl.PAYMENT_FAILED.text': 'Merhaba {firstName}, {amount} tutarındaki ödemeniz alınamadı. Lütfen ödeme bilgilerinizi güncelleyin.',
  'msgTpl.OTP.subject': 'Doğrulama kodu',
  'msgTpl.OTP.text': 'Doğrulama kodunuz: {code}',
  'msgTpl.BIRTHDAY.subject': 'Doğum gününüz kutlu olsun',
  'msgTpl.BIRTHDAY.text': 'İyi ki doğdun {firstName}! {studioName} ailesi olarak doğum gününüzü kutlarız.',
  'msgTpl.WIN_BACK.subject': 'Sizi özledik',
  'msgTpl.WIN_BACK.text': 'Merhaba {firstName}, sizi bir süredir aramızda göremedik. {studioName} olarak sizi tekrar aramızda görmek isteriz.',
  'msgTpl.FIRST_CLASS_FOLLOW_UP.subject': 'İlk seansınız nasıl geçti?',
  'msgTpl.FIRST_CLASS_FOLLOW_UP.text': 'Merhaba {firstName}, {studioName} ile ilk seansınız nasıl geçti? Görüşleriniz bizim için değerli.',
  'msgTpl.NO_SHOW_FOLLOW_UP.subject': 'Seansınızı kaçırdınız',
  'msgTpl.NO_SHOW_FOLLOW_UP.text': 'Merhaba {firstName}, {startTime} saatindeki {serviceName} seansınıza katılamadınız. Yeni bir rezervasyon oluşturmak ister misiniz?',
  'msgTpl.INVITE_LINK.subject': '{studioName} sizi davet ediyor',
  'msgTpl.INVITE_LINK.text': '{studioName} sizi davet ediyor: {inviteUrl}',
  'msgTpl.INVITE_LINK.cta': 'Daveti aç',
  'msgTpl.INBOX_HELP_REPLY.subject': 'Yardım',
  'msgTpl.INBOX_HELP_REPLY.text': '{studioName}: Bu numaraya yazdığınız mesajlar ekibimize ulaşır. Ticari mesajları durdurmak için DUR yazabilirsiniz.',
  'msgTpl.INBOX_OPT_OUT_CONFIRM.subject': 'Abonelikten çıktınız',
  'msgTpl.INBOX_OPT_OUT_CONFIRM.text': '{studioName}: Ticari mesaj listemizden çıkarıldınız. Rezervasyon ve hesap bildirimleri devam eder.',

  'msgTpl.email.reasonCommercial': 'Bu e-postayı {studioName} ile iletişim izniniz olduğu için aldınız.',
  'msgTpl.email.reasonTransactional': 'Bu e-posta {studioName} hesabınızla ilgili bir bilgilendirmedir.',
  'msgTpl.email.unsubscribe': 'Abonelikten çık',
} as const satisfies Record<string, string>;
