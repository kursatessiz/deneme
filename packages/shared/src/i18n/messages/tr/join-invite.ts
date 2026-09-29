/** Web invite landing page /j/<token>: phone code, PIN and consent, then sign-in (M1 platform invites; works for any invite). */
export const trJoinInvite = {
  'joinInvite.title': 'Davet',
  'joinInvite.invitedTo': '{name} sizi davet etti',
  'joinInvite.role': 'Rol: {role}',
  'joinInvite.greeting': 'Merhaba {fullName}',
  'joinInvite.invalid': 'Davet bulunamadı, süresi dolmuş veya daha önce kullanılmış.',
  'joinInvite.sendCode': 'Doğrulama kodu gönder',
  'joinInvite.codeSentTo': 'Kod {phone} numarasına gönderildi.',
  'joinInvite.code': 'Doğrulama kodu',
  'joinInvite.pin': 'Yeni PIN (6 hane)',
  'joinInvite.pinHint': 'Mobil uygulamaya giriş için kullanılır. Daha önce PIN belirlediyseniz boş bırakabilirsiniz.',
  'joinInvite.documents': 'Onaylamanız gereken metinler',
  'joinInvite.accept': 'Okudum ve onaylıyorum',
  'joinInvite.submit': 'Daveti kabul et',
  'joinInvite.submitting': 'Gönderiliyor...',
  'joinInvite.failed': 'Davet kabul edilemedi.',
} as const satisfies Record<string, string>;
