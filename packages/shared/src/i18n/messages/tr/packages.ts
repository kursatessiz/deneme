/** Web package definitions list (`/packages`). */
export const trPackages = {
  'packages.title': 'Paket Tanımları',
  'packages.subtitle': 'Satışa açık seans/kredi paketleri',
  'packages.empty.title': 'Henüz paket tanımı yok',
  'packages.empty.description': 'İşletme ayarlarından yeni bir paket tanımladığınızda burada görünecek.',
  'packages.units.one': '{count} birim',
  'packages.units.other': '{count} birim',
  'packages.unlimited': 'Sınırsız',
  'packages.validity.one': '{count} gün geçerli',
  'packages.validity.other': '{count} gün geçerli',
  'packages.freezeDays.one': '{count} gün dondurma hakkı',
  'packages.freezeDays.other': '{count} gün dondurma hakkı',
} as const satisfies Record<string, string>;
