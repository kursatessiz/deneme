/** Mobile app: Hesabım > İşletme teması (owner theme family/gradient/primary color editor). */
export const trMTheme = {
  'mTheme.lead':
    'Seçtiğiniz tema üyelerinizin ve ekibinizin varsayılanıdır. Kullanıcılar kendi cihazlarında farklı bir tema seçebilir; logo, ana renk ve gradyan her zaman işletmenizin kalır.',
  'mTheme.family': 'Tema ailesi',
  'mTheme.recommendedFor': 'Uygun: {recommendedFor}.',
  'mTheme.gradient': 'Gradyan',
  'mTheme.primaryColor': 'Ana renk: {color}',
  'mTheme.saved': 'Tema kaydedildi.',
  'mTheme.save': 'Kaydet',
  'mTheme.errors.loadFailed': 'Tema yüklenemedi.',
  'mTheme.errors.saveFailed': 'Tema kaydedilemedi.',
} as const satisfies Record<string, string>;
