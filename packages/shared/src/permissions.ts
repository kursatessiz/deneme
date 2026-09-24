/**
 * Permission catalogue: the single source of permission keys. Role templates
 * store subsets of these keys; every API endpoint declares one of them with
 * @RequirePermission and UI menus render from the effective set.
 *
 * Adding a key is backwards compatible. Renaming or removing one needs a
 * migration of role_template_permissions.
 */
export const PERMISSIONS = {
  'studio.settings.view': 'İşletme ayarlarını görüntüleme',
  'studio.settings.manage': 'İşletme ayarlarını ve temayı düzenleme',
  'roles.manage': 'Rol ve yetkileri yönetme',
  'staff.manage': 'Personel davet etme ve yönetme',
  'branches.manage': 'Şube ekleme, düzenleme ve personelin şube erişimini belirleme',

  'members.view': 'Üye listesini ve kartını görüntüleme',
  'members.contact.view': 'Üye telefon ve e-posta bilgisini görme',
  // Also gates the opt-in Apple Health / Health Connect trend view on the
  // member card (W21); the member's shareWithStudio toggle must be on too.
  'members.health.view': 'Üye sağlık notlarını ve sağlık verisi eğilimlerini görme',
  'members.manage': 'Üye ekleme, düzenleme, davet gönderme',

  'catalog.view': 'Hizmet, kaynak ve iptal politikası kataloğunu görüntüleme',
  'catalog.manage': 'Hizmet, kaynak, paket ve iptal politikalarını yönetme',

  'schedule.view': 'Takvimi görüntüleme',
  'schedule.manage': 'Seans oluşturma, düzenleme, eğitmen değiştirme',

  'bookings.view': 'Rezervasyonları görüntüleme',
  'bookings.manage': 'Üye adına rezervasyon oluşturma ve iptal etme',
  'attendance.manage': 'Yoklama alma ve check-in',

  'packages.sell': 'Paket satışı, dondurma ve devir',
  'promotions.manage': 'Promosyon kodu ve hediye kartı yönetimi',

  'measurements.view': 'Ölçümleri görüntüleme',
  'measurements.manage': 'Ölçüm kaydetme',

  'finance.view': 'Gelir, gider ve borçları görüntüleme',
  'finance.manage': 'Ödeme ve gider kaydetme',
  'commissions.view.own': 'Kendi hakedişini görüntüleme',
  'commissions.view.all': 'Tüm hakedişleri görüntüleme',
  'payroll.manage': 'Hakediş bordrosu oluşturma, düzeltme, onaylama ve ödenmiş işaretleme',

  'notifications.manage': 'Bildirim şablonları ve SMS kredisi',
  'reports.view': 'Raporları görüntüleme',

  'leads.view': 'Potansiyel üyeleri görüntüleme',
  'leads.manage': 'Potansiyel üye ekleme, aşama değiştirme, üyeliğe dönüştürme',

  'integrations.manage': 'API anahtarı ve webhook yönetimi',

  'integrations.partners.manage': 'Toplayıcı/pazaryeri partner bağlantılarını yönetme',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

export interface DefaultRoleTemplate {
  key: string;
  name: string;
  isOwner: boolean;
  permissions: readonly PermissionKey[];
}

/**
 * Created for every new tenant. The owner template always resolves to every
 * permission, including keys added later. Tenants can edit the others.
 * Members get no staff permissions; their self-service access comes from
 * having a member profile.
 */
export const DEFAULT_ROLE_TEMPLATES: readonly DefaultRoleTemplate[] = [
  { key: 'owner', name: 'İşletme Sahibi', isOwner: true, permissions: ALL_PERMISSIONS },
  {
    key: 'reception',
    name: 'Resepsiyon',
    isOwner: false,
    permissions: [
      'studio.settings.view',
      'members.view',
      'members.contact.view',
      'members.manage',
      'catalog.view',
      'schedule.view',
      'schedule.manage',
      'bookings.view',
      'bookings.manage',
      'attendance.manage',
      'packages.sell',
      'finance.view',
      'finance.manage',
      'leads.view',
      'leads.manage',
    ],
  },
  {
    key: 'trainer',
    name: 'Eğitmen',
    isOwner: false,
    // Sees members and takes attendance, but not their phone numbers.
    permissions: [
      'members.view',
      'members.health.view',
      'schedule.view',
      'bookings.view',
      'attendance.manage',
      'measurements.view',
      'measurements.manage',
      'commissions.view.own',
    ],
  },
  { key: 'member', name: 'Üye', isOwner: false, permissions: [] },
];

/** Effective permissions of a role template. */
export function resolvePermissions(role: { isOwner: boolean; permissions: readonly string[] }): PermissionKey[] {
  if (role.isOwner) return [...ALL_PERMISSIONS];
  return role.permissions.filter(isPermissionKey);
}
