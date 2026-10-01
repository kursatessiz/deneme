import { z } from 'zod';
import { isPermissionKey, type PermissionKey } from './permissions';
import { PhoneSchema } from './validators';

/**
 * Platform permission catalogue (docs/PAZARLAMA_MODULU.md 2.2). Separate
 * from the tenant catalogue in permissions.ts: these keys describe what a
 * platform-level account (e.g. the marketing admin) may do across the
 * platform's own marketing, never inside another tenant.
 *
 * `User.isSuperAdmin` stays the root: a super admin implicitly holds every
 * key here and needs no PlatformMembership row. Super-admin status is never
 * granted through a platform role template.
 */
export const PLATFORM_PERMISSIONS = {
  'platform.marketing.view': 'Pazarlama panelini, KPI panosunu ve raporları görme',
  'platform.marketing.manage': 'Platform kiracısında CRM, segment, kampanya, akış, şablon, site ve huni taslağı hazırlama ve düzenleme',
  'platform.marketing.send': 'Onay eşiğinin altındaki gönderimleri kendi onayıyla başlatma',
  'platform.marketing.approve': 'Başkasının gönderim veya harcama talebini onaylama',
  'platform.inbox.reply': 'Platform gelen kutusunda cevap yazma',
  'platform.ads.view': 'Reklam performansı ve harcamayı görme',
  'platform.ads.manage': 'Reklam bağlantıları, UTM, adlandırma ve reklam durdurma',
  'platform.ads.spend': 'Bütçe değiştirme ve kampanya etkinleştirme talebi (onaya tabi)',
  'platform.social.publish': 'Organik sosyal gönderi planlama (onaya tabi)',
  'platform.integrations.manage': 'Pazarlama entegrasyonları: reklam, sosyal, Zapier/webhook, API anahtarı, e-posta gönderen alan adı',
  'platform.ai.use': 'Yapay zeka stüdyosunu kullanma (platform kiracısının bütçesinden)',
  'platform.brand.manage': 'Marka kiti ve ürün gerçeklerini yönetme',
  'platform.contacts.export': 'Platform kişi listesini dışa aktarma',
  'platform.referrals.view': 'İşletme tavsiye programı raporunu görme (salt okunur)',
  'platform.users.manage': 'Platform kullanıcılarını davet etme ve rol verme',
} as const;

export type PlatformPermissionKey = keyof typeof PLATFORM_PERMISSIONS;

export const ALL_PLATFORM_PERMISSIONS = Object.keys(PLATFORM_PERMISSIONS) as PlatformPermissionKey[];

export function isPlatformPermissionKey(value: string): value is PlatformPermissionKey {
  return Object.prototype.hasOwnProperty.call(PLATFORM_PERMISSIONS, value);
}

/**
 * Keys that no platform role template may hold: only the super admin has
 * them (implicitly). The template editor never offers them and
 * resolvePlatformPermissions drops them even if a row was stored.
 */
export const SUPER_ADMIN_ONLY_PLATFORM_PERMISSIONS: readonly PlatformPermissionKey[] = ['platform.users.manage'];

/** Grouping for the platform role editor, same pattern as PERMISSION_AREAS. */
export const PLATFORM_PERMISSION_AREAS = {
  Pazarlama: ['platform.marketing.view', 'platform.marketing.manage', 'platform.marketing.send', 'platform.marketing.approve', 'platform.inbox.reply'],
  Reklam: ['platform.ads.view', 'platform.ads.manage', 'platform.ads.spend', 'platform.social.publish'],
  Entegrasyon: ['platform.integrations.manage'],
  'Yapay zeka ve marka': ['platform.ai.use', 'platform.brand.manage'],
  'Veri ve raporlar': ['platform.contacts.export', 'platform.referrals.view'],
  Yönetim: ['platform.users.manage'],
} as const satisfies Record<string, readonly PlatformPermissionKey[]>;

/**
 * The only mapping from platform permissions to tenant permissions on the
 * platform tenant (doc 2.3). A platform member gets a system-managed
 * Membership in the platform tenant whose role template holds exactly
 * resolvePlatformTenantPermissions(<their platform permissions>).
 */
export const PLATFORM_TENANT_GRANTS: Readonly<Record<PlatformPermissionKey, readonly PermissionKey[]>> = {
  'platform.marketing.view': ['crm.view', 'segments.view', 'campaigns.view', 'journeys.view', 'inbox.view', 'reports.view', 'site.view'],
  'platform.marketing.manage': [
    'crm.manage',
    'segments.manage',
    'campaigns.manage',
    'journeys.manage',
    'funnels.manage',
    'site.manage',
    'sites.articles.manage',
    'notifications.manage',
  ],
  'platform.marketing.send': [],
  'platform.marketing.approve': [],
  'platform.inbox.reply': ['inbox.reply', 'inbox.manage'],
  'platform.ads.view': ['ads.view'],
  'platform.ads.manage': ['ads.manage'],
  'platform.ads.spend': [],
  'platform.social.publish': [],
  'platform.integrations.manage': ['integrations.manage'],
  'platform.ai.use': ['ai.use'],
  'platform.brand.manage': [],
  'platform.contacts.export': ['crm.export'],
  'platform.referrals.view': [],
  'platform.users.manage': [],
};

/**
 * Tenant keys a platform grant must never produce, whatever the mapping
 * above says: role and staff administration, tenant settings, the
 * subscription, and every finance, payout, payroll and accounting key.
 */
const FORBIDDEN_EXACT: readonly PermissionKey[] = [
  'roles.manage',
  'staff.manage',
  'studio.settings.manage',
  'billing.manage',
  'payroll.manage',
  'accounting.export',
  'branches.manage',
  'members.manage',
  'members.health.view',
];
const FORBIDDEN_PREFIXES = ['finance.', 'payouts.', 'commissions.', 'payroll.', 'accounting.', 'billing.'];

export function isForbiddenPlatformTenantGrant(key: string): boolean {
  return (FORBIDDEN_EXACT as readonly string[]).includes(key) || FORBIDDEN_PREFIXES.some((p) => key.startsWith(p));
}

/** Effective platform permissions of a stored platform role template (unknown and super-admin-only keys dropped). */
export function resolvePlatformPermissions(keys: readonly string[]): PlatformPermissionKey[] {
  const out = new Set<PlatformPermissionKey>();
  for (const key of keys) {
    if (isPlatformPermissionKey(key) && !(SUPER_ADMIN_ONLY_PLATFORM_PERMISSIONS as readonly string[]).includes(key)) out.add(key);
  }
  return ALL_PLATFORM_PERMISSIONS.filter((k) => out.has(k));
}

/** Pure: the tenant permissions a set of platform permissions yields on the platform tenant. Sorted, deduplicated, never a forbidden key. */
export function resolvePlatformTenantPermissions(platformPermissions: readonly string[]): PermissionKey[] {
  const out = new Set<PermissionKey>();
  for (const key of platformPermissions) {
    if (!isPlatformPermissionKey(key)) continue;
    for (const tenantKey of PLATFORM_TENANT_GRANTS[key]) {
      if (isPermissionKey(tenantKey) && !isForbiddenPlatformTenantGrant(tenantKey)) out.add(tenantKey);
    }
  }
  return [...out].sort();
}

export interface DefaultPlatformRoleTemplate {
  key: string;
  name: string;
  permissions: readonly PlatformPermissionKey[];
}

export const MARKETING_ADMIN_ROLE_KEY = 'marketing_admin';

export const DEFAULT_PLATFORM_ROLE_TEMPLATES: readonly DefaultPlatformRoleTemplate[] = [
  {
    key: MARKETING_ADMIN_ROLE_KEY,
    name: 'Pazarlama yöneticisi',
    permissions: [
      'platform.marketing.view',
      'platform.marketing.manage',
      'platform.marketing.send',
      'platform.inbox.reply',
      'platform.ads.view',
      'platform.ads.manage',
      'platform.ads.spend',
      'platform.social.publish',
      'platform.integrations.manage',
      'platform.ai.use',
      'platform.brand.manage',
      'platform.referrals.view',
    ],
  },
];

/**
 * Key prefix of the system-managed RoleTemplate a platform role template
 * is mirrored to inside the platform tenant. Such templates are locked:
 * tenant role screens can neither edit, delete, assign nor invite with them.
 */
export const PLATFORM_SYSTEM_ROLE_PREFIX = 'platform:';

export function platformSystemRoleKey(platformRoleKey: string): string {
  return `${PLATFORM_SYSTEM_ROLE_PREFIX}${platformRoleKey}`;
}

export function isPlatformSystemRoleKey(key: string): boolean {
  return key.startsWith(PLATFORM_SYSTEM_ROLE_PREFIX);
}

// ---------------------------------------------------------------------------
// Stable API error codes (translated by the web BFF, TRANSLATED_API_ERROR_CODES)
// ---------------------------------------------------------------------------

export const PLATFORM_ACCESS_ERROR_CODES = {
  mfaRequired: 'MFA_REQUIRED',
  mfaEnrollmentRequired: 'MFA_ENROLLMENT_REQUIRED',
  mfaInvalidCode: 'MFA_INVALID_CODE',
  platformAccessDenied: 'PLATFORM_ACCESS_DENIED',
  platformTenantInvite: 'PLATFORM_TENANT_INVITE_FORBIDDEN',
  systemRoleLocked: 'SYSTEM_ROLE_LOCKED',
} as const;

export const PLATFORM_ACCESS_TRANSLATED_ERRORS = {
  [PLATFORM_ACCESS_ERROR_CODES.mfaRequired]: 'twoFactor.error.MFA_REQUIRED',
  [PLATFORM_ACCESS_ERROR_CODES.mfaEnrollmentRequired]: 'twoFactor.error.MFA_ENROLLMENT_REQUIRED',
  [PLATFORM_ACCESS_ERROR_CODES.mfaInvalidCode]: 'twoFactor.error.MFA_INVALID_CODE',
  [PLATFORM_ACCESS_ERROR_CODES.platformAccessDenied]: 'adminPlatformUsers.error.PLATFORM_ACCESS_DENIED',
  [PLATFORM_ACCESS_ERROR_CODES.platformTenantInvite]: 'adminPlatformUsers.error.PLATFORM_TENANT_INVITE_FORBIDDEN',
  [PLATFORM_ACCESS_ERROR_CODES.systemRoleLocked]: 'adminPlatformUsers.error.SYSTEM_ROLE_LOCKED',
} as const;

// ---------------------------------------------------------------------------
// DTOs and request schemas
// ---------------------------------------------------------------------------

export type PlatformMembershipStatus = 'INVITED' | 'ACTIVE' | 'PASSIVE';

/** Returned by /auth/me for a platform-level account. Super admins get every key. */
export interface PlatformAccessDTO {
  permissions: PlatformPermissionKey[];
  platformStudioId: string | null;
  roleName: string | null;
}

/** Two-step verification state of the signed-in session (/auth/me). */
export interface SessionMfaDTO {
  /** The user has confirmed a TOTP authenticator. */
  enabled: boolean;
  /** This session passed the TOTP step. */
  verified: boolean;
  /** A platform-level account without 2FA while the platform policy requires it: enrol before continuing. */
  enrollmentRequired: boolean;
}

export interface PlatformRoleTemplateDTO {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  permissions: PlatformPermissionKey[];
}

export interface PlatformMemberDTO {
  id: string;
  userId: string;
  fullName: string;
  phoneMasked: string;
  status: PlatformMembershipStatus;
  roleTemplateId: string;
  roleName: string;
  mfaEnabled: boolean;
  invitedAt: string;
  activatedAt: string | null;
  deactivatedAt: string | null;
  /** Newest pending invite for an INVITED member. */
  inviteExpiresAt: string | null;
}

export interface PlatformContextDTO {
  platformStudioId: string;
  studioName: string;
  currency: string;
  defaultLocale: string;
  isSuperAdmin: boolean;
  permissions: PlatformPermissionKey[];
  /** Tenant permissions on the platform tenant, for the reused dashboard pages. */
  tenantPermissions: PermissionKey[];
}

export interface PlatformAccessSettingsDTO {
  require2faForPlatformRoles: boolean;
}

export const PlatformInviteSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  phone: PhoneSchema,
  roleTemplateId: z.string().uuid(),
  channel: z.enum(['SHOWN', 'SMS', 'WHATSAPP']).default('SHOWN'),
});
export type PlatformInviteInput = z.infer<typeof PlatformInviteSchema>;

export const ChangePlatformRoleSchema = z.object({ roleTemplateId: z.string().uuid() });
export type ChangePlatformRoleInput = z.infer<typeof ChangePlatformRoleSchema>;

export const PlatformAccessSettingsSchema = z.object({ require2faForPlatformRoles: z.boolean() });
export type PlatformAccessSettingsInput = z.infer<typeof PlatformAccessSettingsSchema>;

// ---------------------------------------------------------------------------
// Two-step verification (TOTP)
// ---------------------------------------------------------------------------

export const MFA_RECOVERY_CODE_COUNT = 10;
export const TotpCodeSchema = z.string().regex(/^\d{6}$/);
/** xxxxx-xxxxx, lowercase base32 alphabet; dashes and case are forgiven on input. */
export const RecoveryCodeSchema = z
  .string()
  .trim()
  .transform((v) => v.toLowerCase().replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[a-z2-7]{10}$/));

export const MfaVerifySchema = z
  .object({ code: TotpCodeSchema.optional(), recoveryCode: RecoveryCodeSchema.optional() })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), { message: 'Kod veya kurtarma kodu girin' });
export type MfaVerifyInput = z.infer<typeof MfaVerifySchema>;

export const MfaConfirmSchema = z.object({ code: TotpCodeSchema });
export type MfaConfirmInput = z.infer<typeof MfaConfirmSchema>;

export interface MfaEnrollmentDTO {
  /** Base32 secret, shown once for manual entry. */
  secret: string;
  otpauthUrl: string;
}

export interface MfaRecoveryCodesDTO {
  recoveryCodes: string[];
}
