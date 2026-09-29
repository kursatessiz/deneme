import { z } from 'zod';

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

  // Deprecated with the /leads endpoints (G1b); kept valid for the
  // compatibility wrappers and the current web and mobile lead screens.
  'leads.view': 'Potansiyel üyeleri görüntüleme',
  'leads.manage': 'Potansiyel üye ekleme, aşama değiştirme, üyeliğe dönüştürme',

  'crm.view': 'Kişileri, satış hattını ve atıf raporlarını görüntüleme',
  'crm.manage': 'Kişi ekleme, düzenleme, birleştirme; etiket, özel alan, satış hattı aşaması ve görev yönetimi',
  'crm.export': 'Kişi listesini CSV olarak dışa aktarma',

  'segments.view': 'Segmentleri ve kitle önizlemesini görüntüleme',
  'segments.manage': 'Segment oluşturma, kurallarını düzenleme ve silme',
  'campaigns.view': 'Kampanyaları ve sonuçlarını görüntüleme',
  'campaigns.manage': 'Kampanya hazırlama, zamanlama, test gönderimi ve iptal',
  'journeys.view': 'Otomatik akışları ve istatistiklerini görüntüleme',
  'journeys.manage': 'Otomatik akış oluşturma, düzenleme, başlatma ve durdurma',

  'inbox.view': 'Gelen kutusundaki konuşmaları görüntüleme',
  'inbox.reply': 'Gelen kutusundan cevap yazma',
  'inbox.manage': 'Konuşma atama, kapatma ve hazır cevapları yönetme',

  'integrations.manage': 'API anahtarı ve webhook yönetimi',

  'integrations.partners.manage': 'Toplayıcı/pazaryeri partner bağlantılarını yönetme',

  'ads.view': 'Reklam performansı raporlarını görüntüleme',
  'ads.manage': 'Reklam platformu bağlantılarını, harcama senkronunu ve UTM ayarlarını yönetme',

  'content.view': 'Video kütüphanesi içeriklerini ve izlenme raporlarını görüntüleme',
  'content.manage': 'Video içeriği ekleme, düzenleme, yayınlama ve seans yayın bağlantısı ayarlama',

  'site.view': 'İşletme web sitesini ve sayfalarını görüntüleme',
  'site.manage': 'İşletme web sitesi sayfalarını düzenleme, yayınlama ve alan adı ayarlama',

  // G3b: drafting campaign, email, SMS and page text and inbox reply
  // suggestions with AI. Counts against the tenant's monthly AI budget, so
  // only the owner has it by default.
  'ai.use': 'Yapay zeka ile metin taslağı ve cevap önerisi oluşturma',

  // G3a: loyalty points. Reception gets view + redeem by default so the
  // front desk can show a balance and hand out a reward; rules, rewards and
  // manual adjustments stay with the owner unless granted.
  'loyalty.view': 'Sadakat puanı bakiyesini ve hareketlerini görüntüleme',
  'loyalty.manage': 'Sadakat programı ayarları, kazanma kuralları, ödüller ve elle puan düzeltme',
  'loyalty.redeem': 'Üye kartında sadakat ödülü kullandırma',

  // G3c-1: events, workshops and multi-session courses. Reception gets
  // view + checkin by default (registrations list and door check-in);
  // creating, publishing, cancelling and refunds stay with the owner.
  'events.view': 'Etkinlikleri ve kayıtları görüntüleme, kayıt listesini dışa aktarma',
  'events.manage': 'Etkinlik oluşturma, yayınlama, iptal etme, bilet ve kayıt yönetimi',
  'events.checkin': 'Etkinlik kayıtlarında giriş (check-in) ve gelmedi işaretleme',
  // G3c-2: retail and stock. Reception gets view + sell by default so the
  // front desk can ring up a sale; the catalogue, stock corrections and
  // refunds stay with the owner unless granted.
  'retail.view': 'Ürünleri, stok durumunu ve satış geçmişini görüntüleme',
  'retail.sell': 'Hızlı satış ekranından ürün satma',
  'retail.manage': 'Ürün kataloğu, fiyatlar ve stok giriş, düzeltme ve transferleri',
  'retail.refund': 'Ürün satışını iade etme veya iptal etme',
  // G3c-3: accounting export. Owner only by default: it carries every
  // customer name, receipt and expense of the period.
  'accounting.export': 'Muhasebe dışa aktarımı (satış ve gider defteri, vergi özeti)',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/**
 * Area a permission belongs to, for grouping the role-template editor's UI.
 * Kept here (next to the catalogue) so a new permission key gets an area at
 * the same time it is added.
 */
export const PERMISSION_AREAS = {
  'İşletme ve roller': ['studio.settings.view', 'studio.settings.manage', 'roles.manage', 'staff.manage', 'branches.manage'],
  Üyeler: ['members.view', 'members.contact.view', 'members.health.view', 'members.manage'],
  Katalog: ['catalog.view', 'catalog.manage'],
  Takvim: ['schedule.view', 'schedule.manage'],
  Rezervasyon: ['bookings.view', 'bookings.manage', 'attendance.manage'],
  Satış: ['packages.sell', 'promotions.manage'],
  Ölçümler: ['measurements.view', 'measurements.manage'],
  Finans: ['finance.view', 'finance.manage', 'commissions.view.own', 'commissions.view.all', 'payroll.manage', 'accounting.export'],
  Bildirim: ['notifications.manage', 'reports.view'],
  'Potansiyel üyeler': ['leads.view', 'leads.manage'],
  'Kişiler (CRM)': ['crm.view', 'crm.manage', 'crm.export'],
  Pazarlama: ['segments.view', 'segments.manage', 'campaigns.view', 'campaigns.manage', 'journeys.view', 'journeys.manage'],
  'Gelen kutusu': ['inbox.view', 'inbox.reply', 'inbox.manage'],
  Entegrasyon: ['integrations.manage', 'integrations.partners.manage'],
  Reklam: ['ads.view', 'ads.manage'],
  İçerik: ['content.view', 'content.manage'],
  'Web sitem': ['site.view', 'site.manage'],
  'Yapay zeka': ['ai.use'],
  Sadakat: ['loyalty.view', 'loyalty.manage', 'loyalty.redeem'],
  Etkinlikler: ['events.view', 'events.manage', 'events.checkin'],
  'Perakende ve stok': ['retail.view', 'retail.sell', 'retail.manage', 'retail.refund'],
} as const satisfies Record<string, readonly PermissionKey[]>;

export type PermissionArea = keyof typeof PERMISSION_AREAS;

/** Zod schema for a single permission key, reused by the role-template validators. */
export const PermissionKeySchema = z.string().refine(isPermissionKey, { message: 'Bilinmeyen izin anahtarı' }) as z.ZodType<PermissionKey>;

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
      'crm.view',
      'crm.manage',
      'inbox.view',
      'inbox.reply',
      'inbox.manage',
      'loyalty.view',
      'loyalty.redeem',
      'events.view',
      'events.checkin',
      'retail.view',
      'retail.sell',
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
