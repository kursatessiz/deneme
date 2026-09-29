/** Super-admin Business Type Templates (İşletme Türü Şablonları) screen. */
export const trAdminBusinessTypes = {
  'adminBusinessTypes.title': 'İşletme Türü Şablonları',
  'adminBusinessTypes.subtitle': 'Varsayılan hizmet/kaynak türleri, kelime dağarcığı ve etkin modüller. Yeni bir kiracıya "Uygula" ile aktarılır.',
  'adminBusinessTypes.form.title': 'Şablon oluştur / güncelle',
  'adminBusinessTypes.form.key': 'Anahtar (ör: yoga_studio)',
  'adminBusinessTypes.form.name': 'Ad',
  'adminBusinessTypes.form.serviceTypes': 'Hizmet türleri (virgülle)',
  'adminBusinessTypes.form.resourceTypes': 'Kaynak türleri (virgülle)',
  'adminBusinessTypes.form.enabledModules': 'Etkin modüller (virgülle)',
  'adminBusinessTypes.form.saveFailed': 'Kaydedilemedi',
  'adminBusinessTypes.form.submit': 'Kaydet',
  'adminBusinessTypes.form.submitting': 'Kaydediliyor...',
  'adminBusinessTypes.accessDenied': 'Erişim yok',
  'adminBusinessTypes.modules': 'Modüller: {modules}',
} as const satisfies Record<string, string>;
