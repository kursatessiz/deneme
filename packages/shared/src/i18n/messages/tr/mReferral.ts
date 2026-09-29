/** Mobile app: Hesabım > Arkadaşını getir (member referral code, share action, status list). */
export const trMReferral = {
  'mReferral.status.pending': 'Beklemede',
  'mReferral.status.qualified': 'Onaylandı',
  'mReferral.status.rewarded': 'Ödül verildi',
  'mReferral.status.voided': 'İptal edildi',
  'mReferral.title': 'Arkadaşını getir',
  'mReferral.subtitle': 'Kodunu arkadaşlarınla paylaş; kaydolduklarında ikiniz de kazanırsınız.',
  'mReferral.yourCode': 'Kodunuz',
  'mReferral.share': 'Paylaş',
  'mReferral.myReferrals': 'Tavsiyelerim',
  'mReferral.noReferralsYet': 'Henüz bir tavsiyeniz yok.',
  'mReferral.errors.loadFailed': 'Tavsiye bilgisi yüklenemedi.',
} as const satisfies Record<string, string>;
