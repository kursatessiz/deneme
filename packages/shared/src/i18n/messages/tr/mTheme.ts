/** Mobile app: Hesabım > İşletme teması (owner logo and primary color editor). */
export const trMTheme = {
  'mTheme.lead':
    'Logo ve ana renk üyelerinizin ve ekibinizin uygulamasında görünür. Açık, koyu veya sistem seçimi her kullanıcıya aittir; logo ve ana renk her zaman işletmenizin kalır.',
  'mTheme.logoUrl': 'Logo adresi',
  'mTheme.primaryColorLabel': 'Ana renk',
  'mTheme.primaryColor': 'Ana renk: {color}',
  'mTheme.colorFormatError': 'Renk #RRGGBB biçiminde olmalı.',
  'mTheme.saved': 'Tema kaydedildi.',
  'mTheme.save': 'Kaydet',
  'mTheme.errors.loadFailed': 'Tema yüklenemedi.',
  'mTheme.errors.saveFailed': 'Tema kaydedilemedi.',
} as const satisfies Record<string, string>;
