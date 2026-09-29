/** Home-screen widget copy (Android app widget, iOS lock/home widget). Rendered outside the app's React tree. */
export const trMWidgets = {
  'mWidgets.noUpcomingSession': 'Yaklaşan ders yok',
  'mWidgets.noActivePackage': 'Aktif paket yok',
  'mWidgets.unlimited': 'Sınırsız',
  'mWidgets.remainingUnits.one': '{count} hak kaldı',
  'mWidgets.remainingUnits.other': '{count} hak kaldı',
} as const satisfies Record<string, string>;
