import {
  PrismaClient,
  Prisma,
  EntitlementKind,
  BookingStatus,
  WaitlistStatus,
  PackageStatus,
  PaymentMethod,
  PaymentStatus,
  CommissionType,
  SubscriptionStatus,
  DocumentType,
  MembershipStatus,
  BadgeKind as PrismaBadgeKind,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEFAULT_ROLE_TEMPLATES, ALL_PERMISSIONS, normalizePhone, THEME_FAMILIES, BadgeKind } from '@platform/shared';
import type { BadgeThresholdParams } from '@platform/shared';

// Seed is a development-only tool: it truncates every table before writing,
// so it must never run against a production database (see CLAUDE.md).
if (process.env.NODE_ENV === 'production') {
  throw new Error('Seed cannot run when NODE_ENV=production. Refusing.');
}

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';

// Tables in no particular order: TRUNCATE ... CASCADE handles FK order for us.
const ALL_TABLES = [
  'audit_logs',
  'automation_runs',
  'automation_rules',
  'communication_consents',
  'notification_logs',
  'message_templates',
  'sms_transactions',
  'sms_wallets',
  'expenses',
  'payments',
  'measurement_entries',
  'measurement_form_templates',
  'waitlist',
  'booking_resources',
  'bookings',
  'session_schedules',
  'family_groups',
  'package_transfers',
  'package_freeze_history',
  'member_packages',
  'package_definition_services',
  'package_definitions',
  'service_type_resource_types',
  'service_types',
  'commission_rules',
  'cancellation_policies',
  'resources',
  'resource_types',
  'trainer_qualifications',
  'trainer_profiles',
  'member_profiles',
  'consents',
  'document_versions',
  'invite_tokens',
  'role_template_permissions',
  'role_templates',
  'memberships',
  'users',
  'branches',
  'feature_flags',
  'subscriptions',
  'studios',
  'sms_packages',
  'plans',
  'business_type_templates',
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

let phoneSeq = 1_000_000;
/** Deterministic, unique Turkish mobile numbers in the canonical +90 form. */
function nextPhone(): string {
  phoneSeq += 1;
  const local = `0532${String(phoneSeq).padStart(7, '0')}`;
  const normalized = normalizePhone(local);
  if (!normalized) throw new Error(`Failed to normalize generated phone ${local}`);
  return normalized;
}

function daysFromNow(days: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

const counts: Record<string, number> = {};
function count(key: string, n = 1) {
  counts[key] = (counts[key] ?? 0) + n;
}

const demoLogins: { label: string; phone: string }[] = [];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Veritabani sifirlaniyor ve ornek veri yukleniyor...');

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE;`);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // -- Platform level -------------------------------------------------------

  const businessTypeTemplates = await createBusinessTypeTemplates();
  const plans = await createPlans();
  await createSmsPackages();
  await createGamificationDefaults();
  const kvkkDoc = await prisma.documentVersion.create({
    data: {
      studioId: null,
      type: DocumentType.KVKK_NOTICE,
      version: 1,
      title: 'KVKK Aydinlatma Metni',
      body:
        'Bu metin, 6698 sayili Kisisel Verilerin Korunmasi Kanunu kapsaminda uyelerimizin ' +
        'kisisel verilerinin hangi amacla islendigini aciklayan ornek bir taslaktir. Gercek ' +
        'kullanimdan once hukuk danismani tarafindan gozden gecirilmelidir.',
      publishedAt: new Date(),
    },
  });
  count('document_versions');
  await prisma.documentVersion.create({
    data: {
      studioId: null,
      type: DocumentType.MEMBERSHIP_CONTRACT,
      version: 1,
      title: 'Uyelik Sozlesmesi',
      body:
        'Bu sozlesme, uye ile isletme arasindaki paket satin alma, iptal ve devir sartlarini ' +
        'duzenleyen ornek bir taslak metindir. Gercek kullanimdan once hukuk danismani ' +
        'tarafindan gozden gecirilmelidir.',
      publishedAt: new Date(),
    },
  });
  count('document_versions');

  const superAdminPhone = nextPhone();
  await prisma.user.create({
    data: {
      phone: superAdminPhone,
      email: 'superadmin@platform.local',
      firstName: 'Kaan',
      lastName: 'Ozturk',
      passwordHash,
      isSuperAdmin: true,
      phoneVerifiedAt: new Date(),
    },
  });
  count('users');
  demoLogins.push({ label: 'Super Admin (Kaan Ozturk)', phone: superAdminPhone });

  // -- Tenants ----------------------------------------------------------------

  const zen = await createZen(businessTypeTemplates.pilates_studio, plans.pro, kvkkDoc.id, passwordHash);
  const flow = await createFlow(businessTypeTemplates.pilates_studio, plans.starter, kvkkDoc.id, passwordHash);
  const guc = await createGuc(businessTypeTemplates.personal_training, plans.pro, kvkkDoc.id, passwordHash);
  const denge = await createDenge(businessTypeTemplates.physiotherapy, plans.starter, kvkkDoc.id, passwordHash);

  // Global identity: the same phone/user is a member at Zen and a trainer at
  // Guc PT, via two separate Membership rows.
  await linkCrossTenantIdentity(zen, guc, passwordHash);

  await seedMessaging({ zen: zen.studioId, flow: flow.studioId, guc: guc.studioId, denge: denge.studioId });

  printSummary();
}

// ---------------------------------------------------------------------------
// W7: messaging - SMS wallets, global message templates, sample consent
// ---------------------------------------------------------------------------

async function seedMessaging(studioIds: { zen: string; flow: string; guc: string; denge: string }) {
  // Every tenant already gets an SmsWallet in scaffoldTenant(); top it up so
  // the e2e suite has enough headroom without touching that shared helper.
  await prisma.smsWallet.updateMany({
    where: { studioId: { in: Object.values(studioIds) } },
    data: { balance: 1000 },
  });

  await createGlobalMessageTemplates();

  for (const studioId of Object.values(studioIds)) {
    await createDefaultAutomationRules(studioId);
  }

  // Zen's demo member (+905321000016, used across the e2e suite) opts in to
  // both channels, so its commercial-consent tests have something to see.
  const demoMember = await prisma.user.findUnique({ where: { phone: '+905321000016' } });
  if (demoMember) {
    for (const channel of ['SMS', 'WHATSAPP'] as const) {
      await prisma.communicationConsent.create({
        data: {
          studioId: studioIds.zen,
          userId: demoMember.id,
          channel,
          status: 'GRANTED',
          source: 'seed',
          grantedAt: new Date(),
        },
      });
      count('communication_consents');
    }
  }
}

interface GlobalTemplateSeed {
  key: string;
  body: string;
  whatsappTemplateName: string;
}

const GLOBAL_TEMPLATES: GlobalTemplateSeed[] = [
  {
    key: 'BOOKING_REMINDER',
    body: 'Merhaba {{firstName}}, {{serviceName}} dersiniz {{startTime}} saatinde başlayacak.',
    whatsappTemplateName: 'booking_reminder_tr',
  },
  {
    key: 'BOOKING_CANCELLED_BY_STUDIO',
    body: 'Merhaba {{firstName}}, {{startTime}} saatindeki {{serviceName}} dersiniz işletme tarafından iptal edildi.',
    whatsappTemplateName: 'booking_cancelled_tr',
  },
  {
    key: 'WAITLIST_PROMOTED',
    body: 'Merhaba {{firstName}}, bekleme listesinde olduğunuz {{serviceName}} dersinde yer açıldı, rezervasyonunuz onaylandı.',
    whatsappTemplateName: 'waitlist_promoted_tr',
  },
  {
    key: 'PACKAGE_EXPIRING',
    body: 'Merhaba {{firstName}}, {{packageName}} paketinizdeki {{remainingUnits}} hakkınızın son kullanım tarihi {{expiryDate}}.',
    whatsappTemplateName: 'package_expiring_tr',
  },
  {
    key: 'PAYMENT_FAILED',
    body: 'Merhaba {{firstName}}, {{amount}} TL tutarındaki ödemeniz alınamadı. Lütfen ödeme bilgilerinizi güncelleyin.',
    whatsappTemplateName: 'payment_failed_tr',
  },
  {
    key: 'OTP',
    body: 'Doğrulama kodunuz: {{code}}',
    whatsappTemplateName: 'otp_tr',
  },
  // W10: automated marketing and lifecycle flows.
  {
    key: 'BIRTHDAY',
    body: 'İyi ki doğdun {{firstName}}! {{studioName}} ailesi olarak doğum gününüzü kutlarız.',
    whatsappTemplateName: 'birthday_tr',
  },
  {
    key: 'WIN_BACK',
    body: 'Merhaba {{firstName}}, sizi bir süredir aramızda göremedik. {{studioName}} olarak sizi tekrar aramızda görmek isteriz.',
    whatsappTemplateName: 'win_back_tr',
  },
  {
    key: 'FIRST_CLASS_FOLLOW_UP',
    body: 'Merhaba {{firstName}}, {{studioName}}\'deki ilk dersiniz nasıl geçti? Görüşleriniz bizim için değerli.',
    whatsappTemplateName: 'first_class_follow_up_tr',
  },
  {
    key: 'NO_SHOW_FOLLOW_UP',
    body: 'Merhaba {{firstName}}, {{startTime}} saatindeki {{serviceName}} dersinize katılamadınız. Yeni bir rezervasyon oluşturmak ister misiniz?',
    whatsappTemplateName: 'no_show_follow_up_tr',
  },
];

/**
 * Default automation rules for a tenant. Everything is inactive except the
 * booking reminder, which already had an equivalent tenant setting
 * (Studio.reminderHoursBefore) so it is safe to turn on by default.
 */
const DEFAULT_AUTOMATION_RULES: {
  type: 'WIN_BACK' | 'PACKAGE_EXPIRING' | 'BIRTHDAY' | 'FIRST_CLASS_FOLLOW_UP' | 'BOOKING_REMINDER' | 'NO_SHOW_FOLLOW_UP';
  name: string;
  params: Record<string, unknown>;
  templateKey: string;
  isActive: boolean;
  isTransactional: boolean;
}[] = [
  {
    type: 'BOOKING_REMINDER',
    name: 'Seans hatırlatması',
    params: { type: 'BOOKING_REMINDER', hoursBefore: 2 },
    templateKey: 'BOOKING_REMINDER',
    isActive: true,
    isTransactional: true,
  },
  {
    type: 'PACKAGE_EXPIRING',
    name: 'Paket bitiş hatırlatması',
    params: { type: 'PACKAGE_EXPIRING', daysBefore: 7 },
    templateKey: 'PACKAGE_EXPIRING',
    isActive: false,
    isTransactional: true,
  },
  {
    type: 'WIN_BACK',
    name: 'Kayıp üye kazanma',
    params: { type: 'WIN_BACK', noAttendanceDays: 30, requireNoActivePackage: true },
    templateKey: 'WIN_BACK',
    isActive: false,
    isTransactional: false,
  },
  {
    type: 'BIRTHDAY',
    name: 'Doğum günü mesajı',
    params: { type: 'BIRTHDAY', daysBefore: 0 },
    templateKey: 'BIRTHDAY',
    isActive: false,
    isTransactional: false,
  },
  {
    type: 'FIRST_CLASS_FOLLOW_UP',
    name: 'İlk ders sonrası geri bildirim',
    params: { type: 'FIRST_CLASS_FOLLOW_UP', hoursAfter: 24 },
    templateKey: 'FIRST_CLASS_FOLLOW_UP',
    isActive: false,
    isTransactional: true,
  },
  {
    type: 'NO_SHOW_FOLLOW_UP',
    name: 'Gelmeme sonrası hatırlatma',
    params: { type: 'NO_SHOW_FOLLOW_UP', hoursAfter: 2 },
    templateKey: 'NO_SHOW_FOLLOW_UP',
    isActive: false,
    isTransactional: true,
  },
];

async function createDefaultAutomationRules(studioId: string) {
  for (const rule of DEFAULT_AUTOMATION_RULES) {
    await prisma.automationRule.create({
      data: {
        studioId,
        type: rule.type,
        name: rule.name,
        params: rule.params as Prisma.InputJsonValue,
        templateKey: rule.templateKey,
        isActive: rule.isActive,
        isTransactional: rule.isTransactional,
      },
    });
    count('automation_rules');
  }
}

// W10: win-back and birthday are unsolicited marketing outreach, so their
// global templates require İYS consent (isTransactional: false). Every other
// template concerns the member's own booking/package and stays transactional.
const MARKETING_TEMPLATE_KEYS = new Set(['WIN_BACK', 'BIRTHDAY']);

async function createGlobalMessageTemplates() {
  for (const t of GLOBAL_TEMPLATES) {
    const isTransactional = !MARKETING_TEMPLATE_KEYS.has(t.key);
    await prisma.messageTemplate.create({
      data: {
        studioId: null,
        key: t.key,
        channel: 'SMS',
        locale: 'tr',
        body: t.body,
        isTransactional,
      },
    });
    count('message_templates');
    await prisma.messageTemplate.create({
      data: {
        studioId: null,
        key: t.key,
        channel: 'WHATSAPP',
        locale: 'tr',
        body: t.body,
        whatsappTemplateName: t.whatsappTemplateName,
        isTransactional,
      },
    });
    count('message_templates');
  }
}

// ---------------------------------------------------------------------------
// Platform level seed data
// ---------------------------------------------------------------------------

async function createBusinessTypeTemplates() {
  const pilates = await prisma.businessTypeTemplate.create({
    data: {
      key: 'pilates_studio',
      name: 'Pilates Studyosu',
      vocabulary: { member: 'Uye', trainer: 'Egitmen', client: 'Uye' },
      defaults: {
        serviceTypeNames: ['Birebir Reformer', 'Grup Reformer', 'Mat Pilates'],
        resourceTypeNames: ['Salon', 'Reformer'],
      },
      enabledModules: ['scheduling', 'packages', 'payments', 'waitlist', 'commissions'],
    },
  });
  count('business_type_templates');

  const personalTraining = await prisma.businessTypeTemplate.create({
    data: {
      key: 'personal_training',
      name: 'Personal Training',
      vocabulary: { member: 'Danisan', trainer: 'Antrenor', client: 'Danisan' },
      defaults: {
        serviceTypeNames: ['Birebir PT', 'Duet PT'],
        resourceTypeNames: ['Antrenman Alani'],
      },
      enabledModules: ['scheduling', 'packages', 'payments', 'commissions'],
    },
  });
  count('business_type_templates');

  const physiotherapy = await prisma.businessTypeTemplate.create({
    data: {
      key: 'physiotherapy',
      name: 'Fizyoterapi',
      vocabulary: { member: 'Danisan', trainer: 'Fizyoterapist', client: 'Danisan' },
      defaults: {
        serviceTypeNames: ['Degerlendirme', 'Seans'],
        resourceTypeNames: ['Tedavi Odasi'],
      },
      enabledModules: ['scheduling', 'packages', 'payments', 'measurements'],
    },
  });
  count('business_type_templates');

  return { pilates_studio: pilates.id, personal_training: personalTraining.id, physiotherapy: physiotherapy.id };
}

async function createPlans() {
  const starter = await prisma.plan.create({
    data: {
      key: 'starter',
      name: 'Starter',
      priceMonthly: 1490,
      limits: { maxBranches: 1, maxActiveMembers: 150, maxStaff: 5 },
    },
  });
  count('plans');

  const pro = await prisma.plan.create({
    data: {
      key: 'pro',
      name: 'Pro',
      priceMonthly: 3490,
      limits: { maxBranches: 3, maxActiveMembers: 800, maxStaff: 25 },
    },
  });
  count('plans');

  return { starter: starter.id, pro: pro.id };
}

async function createSmsPackages() {
  const packages = [
    { key: 'sms_1000', name: '1.000 SMS Kredisi', credits: 1000, price: 350 },
    { key: 'sms_5000', name: '5.000 SMS Kredisi', credits: 5000, price: 1500 },
    { key: 'sms_10000', name: '10.000 SMS Kredisi', credits: 10000, price: 2750 },
  ];
  for (const p of packages) {
    await prisma.smsPackage.create({ data: p });
    count('sms_packages');
  }
}

// ---------------------------------------------------------------------------
// W16: gamification global badge defaults (studioId null, offered to every tenant)
// ---------------------------------------------------------------------------

async function createGamificationDefaults() {
  const badges: { key: string; name: string; description: string; kind: BadgeKind; threshold: BadgeThresholdParams }[] = [
    {
      key: 'first-session',
      name: 'İlk adım',
      description: 'İlk seansına katıldın.',
      kind: BadgeKind.FIRST_SESSION,
      threshold: { kind: BadgeKind.FIRST_SESSION },
    },
    ...[1, 10, 25, 50, 100, 250].map((sessions) => ({
      key: `milestone-${sessions}`,
      name: `${sessions}. seans`,
      description: `Toplam ${sessions} seansa katıldın.`,
      kind: BadgeKind.MILESTONE_SESSIONS,
      threshold: { kind: BadgeKind.MILESTONE_SESSIONS, sessions } as BadgeThresholdParams,
    })),
    ...[4, 8, 12].map((weeks) => ({
      key: `streak-${weeks}-weeks`,
      name: `${weeks} haftalık seri`,
      description: `${weeks} hafta üst üste en az bir seansa katıldın.`,
      kind: BadgeKind.STREAK_WEEKS,
      threshold: { kind: BadgeKind.STREAK_WEEKS, weeks, minSessionsPerWeek: 1 } as BadgeThresholdParams,
    })),
    {
      key: 'variety-3',
      name: 'Çok yönlü',
      description: '3 farklı hizmet türünde seansa katıldın.',
      kind: BadgeKind.VARIETY,
      threshold: { kind: BadgeKind.VARIETY, distinctServiceTypes: 3 },
    },
    {
      key: 'early-bird',
      name: 'Erken kuş',
      description: 'Saat 08:00\'den önce başlayan bir seansa katıldın.',
      kind: BadgeKind.EARLY_BIRD,
      threshold: { kind: BadgeKind.EARLY_BIRD, beforeHour: 8 },
    },
    {
      key: 'monthly-goal-met',
      name: 'Hedefini tuttur',
      description: 'Bir ayın hedefini tamamladın.',
      kind: BadgeKind.MONTHLY_GOAL_MET,
      threshold: { kind: BadgeKind.MONTHLY_GOAL_MET },
    },
  ];

  for (const badge of badges) {
    await prisma.badgeDefinition.create({
      data: {
        studioId: null,
        key: badge.key,
        name: badge.name,
        description: badge.description,
        // Prisma's generated BadgeKind is structurally identical to the shared
        // one but a distinct nominal type; cast once at this boundary.
        kind: badge.kind as unknown as PrismaBadgeKind,
        threshold: badge.threshold,
        isActive: true,
      },
    });
    count('badge_definitions');
  }
}

// ---------------------------------------------------------------------------
// Shared tenant-building blocks
// ---------------------------------------------------------------------------

interface TenantScaffold {
  studioId: string;
  roleTemplateIds: Record<string, string>;
}

/** Subscription + SMS wallet + the four default role templates and their permissions. */
async function scaffoldTenant(studioId: string, planId: string, smsBalance: number): Promise<TenantScaffold> {
  await prisma.subscription.create({
    data: {
      studioId,
      planId,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: daysFromNow(-15, 0),
      currentPeriodEnd: daysFromNow(15, 0),
    },
  });
  count('subscriptions');

  await prisma.smsWallet.create({ data: { studioId, balance: smsBalance } });
  count('sms_wallets');

  const roleTemplateIds: Record<string, string> = {};
  for (const template of DEFAULT_ROLE_TEMPLATES) {
    const created = await prisma.roleTemplate.create({
      data: { studioId, key: template.key, name: template.name, isOwner: template.isOwner, isSystem: true },
    });
    count('role_templates');
    roleTemplateIds[template.key] = created.id;

    // Owner gets every permission, including keys added after this template
    // was authored (see packages/shared/src/permissions.ts).
    const permissionKeys = template.isOwner ? ALL_PERMISSIONS : template.permissions;
    if (permissionKeys.length > 0) {
      await prisma.roleTemplatePermission.createMany({
        data: permissionKeys.map((permissionKey) => ({ roleTemplateId: created.id, permissionKey })),
      });
      count('role_template_permissions', permissionKeys.length);
    }
  }

  return { studioId, roleTemplateIds };
}

interface CreatedUser {
  userId: string;
  membershipId: string;
  phone: string;
  firstName: string;
  lastName: string;
}

async function createUserWithMembership(opts: {
  studioId: string;
  roleTemplateId: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  isTrainerLike?: boolean;
}): Promise<CreatedUser> {
  const phone = nextPhone();
  const user = await prisma.user.create({
    data: {
      phone,
      email: null,
      firstName: opts.firstName,
      lastName: opts.lastName,
      passwordHash: opts.passwordHash,
      phoneVerifiedAt: new Date(),
    },
  });
  count('users');

  const membership = await prisma.membership.create({
    data: {
      userId: user.id,
      studioId: opts.studioId,
      roleTemplateId: opts.roleTemplateId,
      status: MembershipStatus.ACTIVE,
      joinedAt: new Date(),
    },
  });
  count('memberships');

  return { userId: user.id, membershipId: membership.id, phone, firstName: opts.firstName, lastName: opts.lastName };
}

async function grantKvkkConsent(membershipId: string, kvkkDocumentVersionId: string) {
  await prisma.consent.create({
    data: { membershipId, documentVersionId: kvkkDocumentVersionId, device: 'seed-script', ip: '127.0.0.1' },
  });
  count('consents');
}

// ---------------------------------------------------------------------------
// Tenant 1: Zen Reformer Pilates (pilates_studio, with an EMS area)
// ---------------------------------------------------------------------------

interface ZenResult {
  studioId: string;
  roleTemplateIds: Record<string, string>;
  memberByIndex: { membershipId: string; memberProfileId: string; firstName: string; lastName: string }[];
}

async function createZen(
  businessTypeTemplateId: string,
  planId: string,
  kvkkDocId: string,
  passwordHash: string,
): Promise<ZenResult> {
  const studio = await prisma.studio.create({
    data: {
      businessTypeTemplateId,
      name: 'Zen Reformer Pilates',
      slug: 'zen-reformer-pilates',
      phone: '+905321110001',
      email: 'info@zenreformer.com',
      address: 'Nisantasi Mah. Abdi Ipekci Cad. No:14/A Sisli / Istanbul',
      themeFamily: THEME_FAMILIES.noir.key,
      themePrimary: '#C8443C',
      gradientPresetKey: THEME_FAMILIES.noir.gradients[0].key,
      maxAdvanceBookingDays: 14,
      reminderHoursBefore: 2,
    },
  });
  count('studios');

  const scaffold = await scaffoldTenant(studio.id, planId, 3200);

  const branch = await prisma.branch.create({
    data: { studioId: studio.id, name: 'Nisantasi Merkez Sube', address: studio.address, phone: studio.phone },
  });
  count('branches');

  // Second location: multi-branch scheduling, staff branch access and per-branch reports.
  const secondBranch = await prisma.branch.create({
    data: { studioId: studio.id, name: 'Kadikoy Sube', address: 'Moda Cad. No:12 Kadikoy, Istanbul', sortOrder: 1 },
  });
  count('branches');

  const policy = await prisma.cancellationPolicy.create({
    data: {
      studioId: studio.id,
      name: 'Standart Iptal Politikasi',
      freeCancelHours: 12,
      lateCancelChargeUnits: 1,
      noShowChargeUnits: 1,
      isDefault: true,
    },
  });
  count('cancellation_policies');

  const commissionFixed = await prisma.commissionRule.create({
    data: { studioId: studio.id, name: 'Seans Basi Sabit Ucret', type: CommissionType.PER_SESSION_FIXED, value: 350 },
  });
  count('commission_rules');
  const commissionPercent = await prisma.commissionRule.create({
    data: { studioId: studio.id, name: 'Ciro Yuzdesi', type: CommissionType.PERCENTAGE, value: 40 },
  });
  count('commission_rules');

  // Resource types
  const rtSalon = await prisma.resourceType.create({
    data: { studioId: studio.id, name: 'Salon', selectableByMember: false },
  });
  count('resource_types');
  const rtReformer = await prisma.resourceType.create({
    data: { studioId: studio.id, name: 'Reformer', selectableByMember: true },
  });
  count('resource_types');
  const rtEms = await prisma.resourceType.create({
    data: { studioId: studio.id, name: 'EMS Cihazi', selectableByMember: true },
  });
  count('resource_types');

  const salon = await prisma.resource.create({
    data: { studioId: studio.id, branchId: branch.id, resourceTypeId: rtSalon.id, name: 'Ana Salon', capacity: 8 },
  });
  count('resources');
  await prisma.resource.create({
    data: { studioId: studio.id, branchId: secondBranch.id, resourceTypeId: rtSalon.id, name: 'Kadikoy Salon', capacity: 6 },
  });
  count('resources');

  const reformers = [];
  for (let i = 1; i <= 6; i += 1) {
    const reformer = await prisma.resource.create({
      data: {
        studioId: studio.id,
        branchId: branch.id,
        resourceTypeId: rtReformer.id,
        parentResourceId: salon.id,
        name: `Reformer ${i}`,
        capacity: 1,
      },
    });
    count('resources');
    reformers.push(reformer);
  }

  const emsDevices = [];
  for (let i = 1; i <= 2; i += 1) {
    const ems = await prisma.resource.create({
      data: {
        studioId: studio.id,
        branchId: branch.id,
        resourceTypeId: rtEms.id,
        name: `EMS Cihazi ${i}`,
        capacity: 1,
        // Simple two-row spot map layout: one device per row.
        layoutX: 0,
        layoutY: i - 1,
        label: String(i),
      },
    });
    count('resources');
    emsDevices.push(ems);
  }

  // Service types
  const svcBirebir = await prisma.serviceType.create({
    data: {
      studioId: studio.id,
      name: 'Birebir Reformer',
      description: 'Bire bir reformer dersi',
      durationMin: 50,
      capacity: 1,
      allowedEntitlementKinds: [EntitlementKind.SESSION_COUNT, EntitlementKind.CREDIT],
      cancellationPolicyId: policy.id,
      commissionRuleId: commissionFixed.id,
    },
  });
  count('service_types');
  await prisma.serviceTypeResourceType.create({
    data: { serviceTypeId: svcBirebir.id, resourceTypeId: rtReformer.id, quantity: 1 },
  });
  count('service_type_resource_types');

  const svcGrup = await prisma.serviceType.create({
    data: {
      studioId: studio.id,
      name: 'Grup Reformer',
      description: 'Grup reformer dersi',
      durationMin: 50,
      capacity: 6,
      allowedEntitlementKinds: [EntitlementKind.TIME_UNLIMITED, EntitlementKind.CREDIT],
      cancellationPolicyId: policy.id,
      commissionRuleId: commissionPercent.id,
    },
  });
  count('service_types');
  await prisma.serviceTypeResourceType.create({
    data: { serviceTypeId: svcGrup.id, resourceTypeId: rtReformer.id, quantity: 1 },
  });
  count('service_type_resource_types');

  const svcEms = await prisma.serviceType.create({
    data: {
      studioId: studio.id,
      name: 'EMS 20 dk',
      description: 'EMS cihazi ile 20 dakikalik antrenman',
      durationMin: 20,
      capacity: 1,
      minRepeatIntervalDays: 2,
      allowedEntitlementKinds: [EntitlementKind.SESSION_COUNT],
      cancellationPolicyId: policy.id,
      commissionRuleId: commissionFixed.id,
    },
  });
  count('service_types');
  await prisma.serviceTypeResourceType.create({
    data: { serviceTypeId: svcEms.id, resourceTypeId: rtEms.id, quantity: 1 },
  });
  count('service_type_resource_types');

  const svcMat = await prisma.serviceType.create({
    data: {
      studioId: studio.id,
      name: 'Mat Pilates',
      description: 'Ekipmansiz mat pilates dersi',
      durationMin: 50,
      capacity: 10,
      allowedEntitlementKinds: [EntitlementKind.TIME_UNLIMITED],
      cancellationPolicyId: policy.id,
      commissionRuleId: commissionPercent.id,
    },
  });
  count('service_types');

  // Package definitions: one of each EntitlementKind.
  const pkgSession = await prisma.packageDefinition.create({
    data: {
      studioId: studio.id,
      name: '10 Seans Birebir Reformer',
      entitlementKind: EntitlementKind.SESSION_COUNT,
      totalUnits: 10,
      validityDays: 60,
      price: 12000,
      freezeDaysAllowed: 15,
      isTransferable: false,
    },
  });
  count('package_definitions');
  await prisma.packageDefinitionService.create({
    data: { packageDefinitionId: pkgSession.id, serviceTypeId: svcBirebir.id, unitCost: 1 },
  });
  count('package_definition_services');

  const pkgUnlimited = await prisma.packageDefinition.create({
    data: {
      studioId: studio.id,
      name: 'Aylik Sinirsiz Grup Uyeligi',
      entitlementKind: EntitlementKind.TIME_UNLIMITED,
      totalUnits: null,
      validityDays: 30,
      price: 4500,
      freezeDaysAllowed: 7,
      isTransferable: false,
    },
  });
  count('package_definitions');
  await prisma.packageDefinitionService.createMany({
    data: [
      { packageDefinitionId: pkgUnlimited.id, serviceTypeId: svcGrup.id, unitCost: 1 },
      { packageDefinitionId: pkgUnlimited.id, serviceTypeId: svcMat.id, unitCost: 1 },
    ],
  });
  count('package_definition_services', 2);

  const pkgCredit = await prisma.packageDefinition.create({
    data: {
      studioId: studio.id,
      name: '20 Kredilik Esnek Paket',
      entitlementKind: EntitlementKind.CREDIT,
      totalUnits: 20,
      validityDays: 90,
      price: 9000,
      freezeDaysAllowed: 10,
      isTransferable: true,
      maxFamilyMembers: 1,
    },
  });
  count('package_definitions');
  await prisma.packageDefinitionService.createMany({
    data: [
      { packageDefinitionId: pkgCredit.id, serviceTypeId: svcBirebir.id, unitCost: 3 },
      { packageDefinitionId: pkgCredit.id, serviceTypeId: svcGrup.id, unitCost: 1 },
    ],
  });
  count('package_definition_services', 2);

  // Staff
  const owner = await createUserWithMembership({
    studioId: studio.id,
    roleTemplateId: scaffold.roleTemplateIds.owner,
    firstName: 'Elif',
    lastName: 'Yilmaz',
    passwordHash,
  });
  await grantKvkkConsent(owner.membershipId, kvkkDocId);
  demoLogins.push({ label: 'Zen Reformer Pilates - Sahip (Elif Yilmaz)', phone: owner.phone });

  const reception = await createUserWithMembership({
    studioId: studio.id,
    roleTemplateId: scaffold.roleTemplateIds.reception,
    firstName: 'Merve',
    lastName: 'Kaya',
    passwordHash,
  });
  await grantKvkkConsent(reception.membershipId, kvkkDocId);

  const trainer1User = await createUserWithMembership({
    studioId: studio.id,
    roleTemplateId: scaffold.roleTemplateIds.trainer,
    firstName: 'Selin',
    lastName: 'Aydin',
    passwordHash,
  });
  const trainer1 = await prisma.trainerProfile.create({
    data: {
      membershipId: trainer1User.membershipId,
      studioId: studio.id,
      bio: 'Uluslararasi pilates federasyonu 3. kademe egitmeni.',
      commissionRuleId: commissionFixed.id,
    },
  });
  count('trainer_profiles');
  await prisma.trainerQualification.createMany({
    data: [
      { trainerProfileId: trainer1.id, serviceTypeId: svcBirebir.id },
      { trainerProfileId: trainer1.id, serviceTypeId: svcGrup.id },
      { trainerProfileId: trainer1.id, serviceTypeId: svcMat.id },
    ],
  });
  count('trainer_qualifications', 3);

  const trainer2User = await createUserWithMembership({
    studioId: studio.id,
    roleTemplateId: scaffold.roleTemplateIds.trainer,
    firstName: 'Burak',
    lastName: 'Sahin',
    passwordHash,
  });
  const trainer2 = await prisma.trainerProfile.create({
    data: {
      membershipId: trainer2User.membershipId,
      studioId: studio.id,
      bio: 'EMS antrenmani ve fonksiyonel hareket uzmani.',
      commissionRuleId: commissionPercent.id,
    },
  });
  count('trainer_profiles');
  await prisma.trainerQualification.createMany({
    data: [
      { trainerProfileId: trainer2.id, serviceTypeId: svcEms.id },
      { trainerProfileId: trainer2.id, serviceTypeId: svcGrup.id },
    ],
  });
  count('trainer_qualifications', 2);

  // Members
  const memberNames: [string, string, string?][] = [
    ['Ayse', 'Demir', 'L4-L5 bel firigi baslangici var, agir rotasyondan kacinilmali.'],
    ['Zeynep', 'Celik'],
    ['Fatma', 'Arslan', 'Diz protezi (sag), yuksek darbeli hareketlerden kacinilmali.'],
    ['Ece', 'Dogan'],
    ['Mert', 'Yildiz'],
    ['Cem', 'Ozkan'],
    ['Deniz', 'Aksoy'],
    ['Gul', 'Turan'],
  ];
  const members: { membershipId: string; memberProfileId: string; firstName: string; lastName: string }[] = [];
  for (const [firstName, lastName, medical] of memberNames) {
    const created = await createUserWithMembership({
      studioId: studio.id,
      roleTemplateId: scaffold.roleTemplateIds.member,
      firstName,
      lastName,
      passwordHash,
    });
    const memberProfile = await prisma.memberProfile.create({
      data: {
        membershipId: created.membershipId,
        studioId: studio.id,
        birthDate: new Date(1988, 4, 14),
        emergencyContactName: `${lastName} Ailesi`,
        emergencyContactPhone: nextPhone(),
        medicalConditions: medical ?? null,
      },
    });
    count('member_profiles');
    await grantKvkkConsent(created.membershipId, kvkkDocId);
    members.push({ membershipId: created.membershipId, memberProfileId: memberProfile.id, firstName, lastName });
  }

  // Sell packages
  const sessionPkgMember = members[0];
  const sessionMemberPackage = await sellPackage(studio.id, sessionPkgMember.memberProfileId, pkgSession, 2);
  const creditPkgMember = members[1];
  const creditMemberPackage = await sellPackage(studio.id, creditPkgMember.memberProfileId, pkgCredit, 0);
  // Six members carry the unlimited group pass so the group class can fill up.
  const unlimitedMembers = members.slice(2, 8);
  const unlimitedMemberPackages: string[] = [];
  for (const m of unlimitedMembers) {
    const mp = await sellPackage(studio.id, m.memberProfileId, pkgUnlimited, 0);
    unlimitedMemberPackages.push(mp.id);
  }

  // Sessions for the next 7 days
  const birebirSlot = daysFromNow(1, 9);
  const scheduleBirebir = await prisma.sessionSchedule.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      serviceTypeId: svcBirebir.id,
      resourceId: salon.id,
      trainerId: trainer1.id,
      title: 'Birebir Reformer',
      startTime: birebirSlot,
      endTime: addMinutes(birebirSlot, 50),
      capacity: 1,
    },
  });
  count('session_schedules');

  const grupSlot = daysFromNow(2, 18);
  const scheduleGrup = await prisma.sessionSchedule.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      serviceTypeId: svcGrup.id,
      resourceId: salon.id,
      trainerId: trainer1.id,
      title: 'Grup Reformer',
      startTime: grupSlot,
      endTime: addMinutes(grupSlot, 50),
      capacity: 6,
    },
  });
  count('session_schedules');

  const emsSlot = daysFromNow(3, 17);
  const scheduleEms = await prisma.sessionSchedule.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      serviceTypeId: svcEms.id,
      trainerId: trainer2.id,
      title: 'EMS 20 dk',
      startTime: emsSlot,
      endTime: addMinutes(emsSlot, 20),
      capacity: 1,
    },
  });
  count('session_schedules');

  const matSlot = daysFromNow(4, 8);
  await prisma.sessionSchedule.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      serviceTypeId: svcMat.id,
      resourceId: salon.id,
      trainerId: trainer1.id,
      title: 'Mat Pilates',
      startTime: matSlot,
      endTime: addMinutes(matSlot, 50),
      capacity: 10,
    },
  });
  count('session_schedules');

  const secondBirebirSlot = daysFromNow(5, 10);
  const scheduleBirebir2 = await prisma.sessionSchedule.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      serviceTypeId: svcBirebir.id,
      resourceId: salon.id,
      trainerId: trainer2.id,
      title: 'Birebir Reformer',
      startTime: secondBirebirSlot,
      endTime: addMinutes(secondBirebirSlot, 50),
      capacity: 1,
    },
  });
  count('session_schedules');

  // Booking: Birebir Reformer using the SESSION_COUNT package, reformer 1.
  await bookWithResource({
    studioId: studio.id,
    scheduleId: scheduleBirebir.id,
    memberId: sessionPkgMember.memberProfileId,
    memberPackageId: sessionMemberPackage.id,
    unitsCharged: 1,
    resourceId: reformers[0].id,
    startTime: birebirSlot,
    endTime: addMinutes(birebirSlot, 50),
  });

  // Booking: second Birebir Reformer using the CREDIT package (burns 3).
  await bookWithResource({
    studioId: studio.id,
    scheduleId: scheduleBirebir2.id,
    memberId: creditPkgMember.memberProfileId,
    memberPackageId: creditMemberPackage.id,
    unitsCharged: 3,
    resourceId: reformers[1].id,
    startTime: secondBirebirSlot,
    endTime: addMinutes(secondBirebirSlot, 50),
  });

  // Booking: Grup Reformer fills to capacity, each member on their own reformer.
  for (let i = 0; i < unlimitedMembers.length; i += 1) {
    await bookWithResource({
      studioId: studio.id,
      scheduleId: scheduleGrup.id,
      memberId: unlimitedMembers[i].memberProfileId,
      memberPackageId: unlimitedMemberPackages[i],
      unitsCharged: 1,
      resourceId: reformers[i].id,
      startTime: grupSlot,
      endTime: addMinutes(grupSlot, 50),
    });
  }
  await prisma.sessionSchedule.update({ where: { id: scheduleGrup.id }, data: { bookedCount: unlimitedMembers.length } });

  // Waitlist: the group class is full, a 7th interested member joins the waitlist.
  await prisma.waitlist.create({
    data: { studioId: studio.id, scheduleId: scheduleGrup.id, memberId: sessionPkgMember.memberProfileId, position: 1 },
  });
  count('waitlist');

  // Booking: EMS using an EMS device, exclusive.
  await bookWithResource({
    studioId: studio.id,
    scheduleId: scheduleEms.id,
    memberId: creditPkgMember.memberProfileId,
    memberPackageId: null,
    unitsCharged: 0,
    resourceId: emsDevices[0].id,
    startTime: emsSlot,
    endTime: addMinutes(emsSlot, 20),
  });
  await prisma.sessionSchedule.update({ where: { id: scheduleEms.id }, data: { bookedCount: 1 } });
  await prisma.sessionSchedule.update({ where: { id: scheduleBirebir.id }, data: { bookedCount: 1 } });
  await prisma.sessionSchedule.update({ where: { id: scheduleBirebir2.id }, data: { bookedCount: 1 } });

  await prisma.expense.createMany({
    data: [
      {
        studioId: studio.id,
        branchId: branch.id,
        category: 'Kira',
        amount: 45000,
        spentAt: daysFromNow(-3, 9),
        note: 'Eylul ayi sube kirasi',
        createdByUserId: owner.userId,
      },
      {
        studioId: studio.id,
        branchId: branch.id,
        category: 'Ekipman Bakimi',
        amount: 2200,
        spentAt: daysFromNow(-1, 11),
        note: 'Reformer yatak bakimi',
        createdByUserId: reception.userId,
      },
    ],
  });
  count('expenses', 2);

  return { studioId: studio.id, roleTemplateIds: scaffold.roleTemplateIds, memberByIndex: members };
}

// ---------------------------------------------------------------------------
// Tenant 2: Flow Pilates & Wellness (pilates_studio, simpler)
// ---------------------------------------------------------------------------

async function createFlow(businessTypeTemplateId: string, planId: string, kvkkDocId: string, passwordHash: string) {
  const studio = await prisma.studio.create({
    data: {
      businessTypeTemplateId,
      name: 'Flow Pilates & Wellness',
      slug: 'flow-pilates-wellness',
      phone: '+905321110002',
      email: 'merhaba@flowpilates.com',
      address: 'Bagdat Caddesi No:240/3 Kadikoy / Istanbul',
      themeFamily: THEME_FAMILIES.nefes.key,
      themePrimary: '#6E8B6B',
      gradientPresetKey: THEME_FAMILIES.nefes.gradients[0].key,
      maxAdvanceBookingDays: 21,
      reminderHoursBefore: 3,
    },
  });
  count('studios');

  const scaffold = await scaffoldTenant(studio.id, planId, 1000);

  const branch = await prisma.branch.create({
    data: { studioId: studio.id, name: 'Kadikoy Sube', address: studio.address, phone: studio.phone },
  });
  count('branches');

  const policy = await prisma.cancellationPolicy.create({
    data: {
      studioId: studio.id,
      name: 'Standart Iptal Politikasi',
      freeCancelHours: 6,
      lateCancelChargeUnits: 1,
      noShowChargeUnits: 1,
      isDefault: true,
    },
  });
  count('cancellation_policies');

  const commission = await prisma.commissionRule.create({
    data: { studioId: studio.id, name: 'Seans Basi Sabit Ucret', type: CommissionType.PER_SESSION_FIXED, value: 300 },
  });
  count('commission_rules');

  const rtSalon = await prisma.resourceType.create({
    data: { studioId: studio.id, name: 'Salon', selectableByMember: false },
  });
  count('resource_types');
  const rtReformer = await prisma.resourceType.create({
    data: { studioId: studio.id, name: 'Reformer', selectableByMember: false },
  });
  count('resource_types');

  const salon = await prisma.resource.create({
    data: { studioId: studio.id, branchId: branch.id, resourceTypeId: rtSalon.id, name: 'Stuidyo Salonu', capacity: 8 },
  });
  count('resources');
  for (let i = 1; i <= 4; i += 1) {
    await prisma.resource.create({
      data: {
        studioId: studio.id,
        branchId: branch.id,
        resourceTypeId: rtReformer.id,
        parentResourceId: salon.id,
        name: `Reformer ${i}`,
        capacity: 1,
      },
    });
    count('resources');
  }

  const svcPrivate = await prisma.serviceType.create({
    data: {
      studioId: studio.id,
      name: 'Birebir Reformer',
      durationMin: 50,
      capacity: 1,
      allowedEntitlementKinds: [EntitlementKind.SESSION_COUNT],
      cancellationPolicyId: policy.id,
      commissionRuleId: commission.id,
    },
  });
  count('service_types');
  await prisma.serviceTypeResourceType.create({
    data: { serviceTypeId: svcPrivate.id, resourceTypeId: rtReformer.id, quantity: 1 },
  });
  count('service_type_resource_types');

  const svcGroup = await prisma.serviceType.create({
    data: {
      studioId: studio.id,
      name: 'Grup Ders',
      durationMin: 55,
      capacity: 8,
      allowedEntitlementKinds: [EntitlementKind.TIME_UNLIMITED],
      cancellationPolicyId: policy.id,
      commissionRuleId: commission.id,
    },
  });
  count('service_types');

  const pkg8 = await prisma.packageDefinition.create({
    data: {
      studioId: studio.id,
      name: '8 Seans Reformer Paketi',
      entitlementKind: EntitlementKind.SESSION_COUNT,
      totalUnits: 8,
      validityDays: 45,
      price: 8800,
      freezeDaysAllowed: 7,
    },
  });
  count('package_definitions');
  await prisma.packageDefinitionService.create({
    data: { packageDefinitionId: pkg8.id, serviceTypeId: svcPrivate.id, unitCost: 1 },
  });
  count('package_definition_services');

  const pkgMonthly = await prisma.packageDefinition.create({
    data: {
      studioId: studio.id,
      name: 'Aylik Sinirsiz Grup Uyeligi',
      entitlementKind: EntitlementKind.TIME_UNLIMITED,
      totalUnits: null,
      validityDays: 30,
      price: 3200,
      freezeDaysAllowed: 5,
    },
  });
  count('package_definitions');
  await prisma.packageDefinitionService.create({
    data: { packageDefinitionId: pkgMonthly.id, serviceTypeId: svcGroup.id, unitCost: 1 },
  });
  count('package_definition_services');

  const owner = await createUserWithMembership({
    studioId: studio.id,
    roleTemplateId: scaffold.roleTemplateIds.owner,
    firstName: 'Derya',
    lastName: 'Polat',
    passwordHash,
  });
  await grantKvkkConsent(owner.membershipId, kvkkDocId);
  demoLogins.push({ label: 'Flow Pilates & Wellness - Sahip (Derya Polat)', phone: owner.phone });

  const reception = await createUserWithMembership({
    studioId: studio.id,
    roleTemplateId: scaffold.roleTemplateIds.reception,
    firstName: 'Naz',
    lastName: 'Erdem',
    passwordHash,
  });
  await grantKvkkConsent(reception.membershipId, kvkkDocId);

  const trainerNames: [string, string][] = [
    ['Yasemin', 'Koc'],
    ['Kerem', 'Tuncel'],
  ];
  const trainerProfiles: string[] = [];
  for (const [firstName, lastName] of trainerNames) {
    const t = await createUserWithMembership({
      studioId: studio.id,
      roleTemplateId: scaffold.roleTemplateIds.trainer,
      firstName,
      lastName,
      passwordHash,
    });
    const profile = await prisma.trainerProfile.create({
      data: { membershipId: t.membershipId, studioId: studio.id, commissionRuleId: commission.id },
    });
    count('trainer_profiles');
    await prisma.trainerQualification.createMany({
      data: [
        { trainerProfileId: profile.id, serviceTypeId: svcPrivate.id },
        { trainerProfileId: profile.id, serviceTypeId: svcGroup.id },
      ],
    });
    count('trainer_qualifications', 2);
    trainerProfiles.push(profile.id);
  }

  const familyGroup = await prisma.familyGroup.create({ data: { studioId: studio.id, name: 'Yildiz Ailesi' } });
  count('family_groups');

  const memberNames: [string, string, string | null][] = [
    ['Pinar', 'Yildiz', null],
    ['Baris', 'Yildiz', null],
    ['Sude', 'Aktas', null],
    ['Onur', 'Bilgin', 'Astim, yogun kardiyo hareketlerinde dikkat.'],
    ['Irem', 'Guler', null],
    ['Tolga', 'Ozer', null],
  ];
  const members: { memberProfileId: string; firstName: string }[] = [];
  for (const [firstName, lastName, medical] of memberNames) {
    const created = await createUserWithMembership({
      studioId: studio.id,
      roleTemplateId: scaffold.roleTemplateIds.member,
      firstName,
      lastName,
      passwordHash,
    });
    const isFamily = lastName === 'Yildiz';
    const profile = await prisma.memberProfile.create({
      data: {
        membershipId: created.membershipId,
        studioId: studio.id,
        familyGroupId: isFamily ? familyGroup.id : null,
        medicalConditions: medical,
      },
    });
    count('member_profiles');
    await grantKvkkConsent(created.membershipId, kvkkDocId);
    members.push({ memberProfileId: profile.id, firstName });
  }

  const privateMember = members[2];
  const privateMemberPackage = await sellPackage(studio.id, privateMember.memberProfileId, pkg8, 1);
  const groupMembers = members.slice(3, 6);
  const groupMemberPackages: string[] = [];
  for (const m of groupMembers) {
    const mp = await sellPackage(studio.id, m.memberProfileId, pkgMonthly, 0);
    groupMemberPackages.push(mp.id);
  }

  const privateSlot = daysFromNow(1, 8);
  const schedulePrivate = await prisma.sessionSchedule.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      serviceTypeId: svcPrivate.id,
      resourceId: salon.id,
      trainerId: trainerProfiles[0],
      title: 'Birebir Reformer',
      startTime: privateSlot,
      endTime: addMinutes(privateSlot, 50),
      capacity: 1,
    },
  });
  count('session_schedules');

  const groupSlot = daysFromNow(3, 19);
  const scheduleGroup = await prisma.sessionSchedule.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      serviceTypeId: svcGroup.id,
      resourceId: salon.id,
      trainerId: trainerProfiles[1],
      title: 'Grup Ders',
      startTime: groupSlot,
      endTime: addMinutes(groupSlot, 55),
      capacity: 8,
    },
  });
  count('session_schedules');

  const secondGroupSlot = daysFromNow(6, 19);
  await prisma.sessionSchedule.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      serviceTypeId: svcGroup.id,
      resourceId: salon.id,
      trainerId: trainerProfiles[0],
      title: 'Grup Ders',
      startTime: secondGroupSlot,
      endTime: addMinutes(secondGroupSlot, 55),
      capacity: 8,
    },
  });
  count('session_schedules');

  await prisma.booking.create({
    data: {
      studioId: studio.id,
      scheduleId: schedulePrivate.id,
      memberId: privateMember.memberProfileId,
      memberPackageId: privateMemberPackage.id,
      status: BookingStatus.CONFIRMED,
      unitsCharged: 1,
    },
  });
  count('bookings');
  await prisma.sessionSchedule.update({ where: { id: schedulePrivate.id }, data: { bookedCount: 1 } });

  for (let i = 0; i < groupMembers.length; i += 1) {
    await prisma.booking.create({
      data: {
        studioId: studio.id,
        scheduleId: scheduleGroup.id,
        memberId: groupMembers[i].memberProfileId,
        memberPackageId: groupMemberPackages[i],
        status: BookingStatus.CONFIRMED,
        unitsCharged: 1,
      },
    });
    count('bookings');
  }
  await prisma.sessionSchedule.update({ where: { id: scheduleGroup.id }, data: { bookedCount: groupMembers.length } });

  await prisma.expense.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      category: 'Temizlik',
      amount: 1800,
      spentAt: daysFromNow(-2, 10),
      note: 'Aylik temizlik hizmeti',
      createdByUserId: owner.userId,
    },
  });
  count('expenses');

  return { studioId: studio.id, roleTemplateIds: scaffold.roleTemplateIds };
}

// ---------------------------------------------------------------------------
// Tenant 3: Guc PT Studyosu (personal_training)
// ---------------------------------------------------------------------------

async function createGuc(businessTypeTemplateId: string, planId: string, kvkkDocId: string, passwordHash: string) {
  const studio = await prisma.studio.create({
    data: {
      businessTypeTemplateId,
      name: 'Guc PT Studyosu',
      slug: 'guc-pt-studyosu',
      phone: '+905321110003',
      email: 'info@gucpt.com',
      address: 'Ataturk Mah. Ertugrul Gazi Sok. No:5 Atasehir / Istanbul',
      themeFamily: THEME_FAMILIES.saha.key,
      themePrimary: '#E8622C',
      gradientPresetKey: THEME_FAMILIES.saha.gradients[0].key,
      maxAdvanceBookingDays: 10,
      reminderHoursBefore: 3,
    },
  });
  count('studios');

  const scaffold = await scaffoldTenant(studio.id, planId, 2000);

  const branch = await prisma.branch.create({
    data: { studioId: studio.id, name: 'Atasehir Sube', address: studio.address, phone: studio.phone },
  });
  count('branches');

  const policy = await prisma.cancellationPolicy.create({
    data: {
      studioId: studio.id,
      name: 'Standart Iptal Politikasi',
      freeCancelHours: 24,
      lateCancelChargeUnits: 1,
      noShowChargeUnits: 1,
      isDefault: true,
    },
  });
  count('cancellation_policies');

  const commission = await prisma.commissionRule.create({
    data: { studioId: studio.id, name: 'Seans Basi Sabit Ucret', type: CommissionType.PER_SESSION_FIXED, value: 400 },
  });
  count('commission_rules');

  const rtAlan = await prisma.resourceType.create({
    data: { studioId: studio.id, name: 'Antrenman Alani', selectableByMember: false },
  });
  count('resource_types');

  const alanlar = [];
  for (let i = 1; i <= 2; i += 1) {
    const alan = await prisma.resource.create({
      data: { studioId: studio.id, branchId: branch.id, resourceTypeId: rtAlan.id, name: `Antrenman Alani ${i}`, capacity: i === 1 ? 1 : 2 },
    });
    count('resources');
    alanlar.push(alan);
  }

  const svcBirebirPt = await prisma.serviceType.create({
    data: {
      studioId: studio.id,
      name: 'Birebir PT',
      durationMin: 60,
      capacity: 1,
      allowedEntitlementKinds: [EntitlementKind.SESSION_COUNT],
      cancellationPolicyId: policy.id,
      commissionRuleId: commission.id,
    },
  });
  count('service_types');
  await prisma.serviceTypeResourceType.create({
    data: { serviceTypeId: svcBirebirPt.id, resourceTypeId: rtAlan.id, quantity: 1 },
  });
  count('service_type_resource_types');

  const svcDuetPt = await prisma.serviceType.create({
    data: {
      studioId: studio.id,
      name: 'Duet PT',
      durationMin: 60,
      capacity: 2,
      allowedEntitlementKinds: [EntitlementKind.SESSION_COUNT],
      cancellationPolicyId: policy.id,
      commissionRuleId: commission.id,
    },
  });
  count('service_types');
  await prisma.serviceTypeResourceType.create({
    data: { serviceTypeId: svcDuetPt.id, resourceTypeId: rtAlan.id, quantity: 1 },
  });
  count('service_type_resource_types');

  const pkgPt = await prisma.packageDefinition.create({
    data: {
      studioId: studio.id,
      name: '12 Seans PT Paketi',
      entitlementKind: EntitlementKind.SESSION_COUNT,
      totalUnits: 12,
      validityDays: 60,
      price: 14400,
      freezeDaysAllowed: 10,
    },
  });
  count('package_definitions');
  await prisma.packageDefinitionService.createMany({
    data: [
      { packageDefinitionId: pkgPt.id, serviceTypeId: svcBirebirPt.id, unitCost: 1 },
      { packageDefinitionId: pkgPt.id, serviceTypeId: svcDuetPt.id, unitCost: 1 },
    ],
  });
  count('package_definition_services', 2);

  const owner = await createUserWithMembership({
    studioId: studio.id,
    roleTemplateId: scaffold.roleTemplateIds.owner,
    firstName: 'Serkan',
    lastName: 'Guclu',
    passwordHash,
  });
  await grantKvkkConsent(owner.membershipId, kvkkDocId);
  demoLogins.push({ label: 'Guc PT Studyosu - Sahip (Serkan Guclu)', phone: owner.phone });

  const reception = await createUserWithMembership({
    studioId: studio.id,
    roleTemplateId: scaffold.roleTemplateIds.reception,
    firstName: 'Aslihan',
    lastName: 'Demirtas',
    passwordHash,
  });
  await grantKvkkConsent(reception.membershipId, kvkkDocId);

  // First of the two trainers is the "normal" local hire.
  const trainer1 = await createUserWithMembership({
    studioId: studio.id,
    roleTemplateId: scaffold.roleTemplateIds.trainer,
    firstName: 'Hakan',
    lastName: 'Ceylan',
    passwordHash,
  });
  const trainer1Profile = await prisma.trainerProfile.create({
    data: { membershipId: trainer1.membershipId, studioId: studio.id, commissionRuleId: commission.id },
  });
  count('trainer_profiles');
  await prisma.trainerQualification.createMany({
    data: [
      { trainerProfileId: trainer1Profile.id, serviceTypeId: svcBirebirPt.id },
      { trainerProfileId: trainer1Profile.id, serviceTypeId: svcDuetPt.id },
    ],
  });
  count('trainer_qualifications', 2);

  const members: { memberProfileId: string; firstName: string }[] = [];
  const memberNames: [string, string, string | null][] = [
    ['Buse', 'Kurt', null],
    ['Emre', 'Tas', 'Omuz ameliyati sonrasi, over-head hareket kisitli.'],
    ['Gizem', 'Ay', null],
    ['Volkan', 'Kara', null],
    ['Sila', 'Bal', null],
  ];
  for (const [firstName, lastName, medical] of memberNames) {
    const created = await createUserWithMembership({
      studioId: studio.id,
      roleTemplateId: scaffold.roleTemplateIds.member,
      firstName,
      lastName,
      passwordHash,
    });
    const profile = await prisma.memberProfile.create({
      data: { membershipId: created.membershipId, studioId: studio.id, medicalConditions: medical },
    });
    count('member_profiles');
    await grantKvkkConsent(created.membershipId, kvkkDocId);
    members.push({ memberProfileId: profile.id, firstName });
  }

  const ptMember = members[0];
  const ptMemberPackage = await sellPackage(studio.id, ptMember.memberProfileId, pkgPt, 1);

  const birebirSlot = daysFromNow(1, 7);
  const scheduleBirebir = await prisma.sessionSchedule.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      serviceTypeId: svcBirebirPt.id,
      resourceId: alanlar[0].id,
      trainerId: trainer1Profile.id,
      title: 'Birebir PT',
      startTime: birebirSlot,
      endTime: addMinutes(birebirSlot, 60),
      capacity: 1,
    },
  });
  count('session_schedules');

  const duetSlot = daysFromNow(4, 18);
  await prisma.sessionSchedule.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      serviceTypeId: svcDuetPt.id,
      resourceId: alanlar[1].id,
      trainerId: trainer1Profile.id,
      title: 'Duet PT',
      startTime: duetSlot,
      endTime: addMinutes(duetSlot, 60),
      capacity: 2,
    },
  });
  count('session_schedules');

  await prisma.booking.create({
    data: {
      studioId: studio.id,
      scheduleId: scheduleBirebir.id,
      memberId: ptMember.memberProfileId,
      memberPackageId: ptMemberPackage.id,
      status: BookingStatus.CONFIRMED,
      unitsCharged: 1,
    },
  });
  count('bookings');
  await prisma.sessionSchedule.update({ where: { id: scheduleBirebir.id }, data: { bookedCount: 1 } });

  await prisma.expense.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      category: 'Ekipman',
      amount: 5400,
      spentAt: daysFromNow(-4, 12),
      note: 'Serbest agirlik seti alimi',
      createdByUserId: owner.userId,
    },
  });
  count('expenses');

  return {
    studioId: studio.id,
    roleTemplateIds: scaffold.roleTemplateIds,
    trainerRoleTemplateId: scaffold.roleTemplateIds.trainer,
    serviceTypeIds: [svcBirebirPt.id, svcDuetPt.id],
    commissionRuleId: commission.id,
  };
}

// ---------------------------------------------------------------------------
// Tenant 4: Denge Fizyoterapi (physiotherapy)
// ---------------------------------------------------------------------------

async function createDenge(businessTypeTemplateId: string, planId: string, kvkkDocId: string, passwordHash: string) {
  const studio = await prisma.studio.create({
    data: {
      businessTypeTemplateId,
      name: 'Denge Fizyoterapi',
      slug: 'denge-fizyoterapi',
      phone: '+905321110004',
      email: 'randevu@dengefizyoterapi.com',
      address: 'Cinnah Cad. No:22/4 Cankaya / Ankara',
      themeFamily: THEME_FAMILIES.atolye.key,
      themePrimary: '#2F6F5E',
      gradientPresetKey: THEME_FAMILIES.atolye.gradients[0].key,
      maxAdvanceBookingDays: 30,
      reminderHoursBefore: 4,
    },
  });
  count('studios');

  const scaffold = await scaffoldTenant(studio.id, planId, 600);

  const branch = await prisma.branch.create({
    data: { studioId: studio.id, name: 'Cankaya Klinigi', address: studio.address, phone: studio.phone },
  });
  count('branches');

  const policy = await prisma.cancellationPolicy.create({
    data: {
      studioId: studio.id,
      name: 'Standart Iptal Politikasi',
      freeCancelHours: 24,
      lateCancelChargeUnits: 1,
      noShowChargeUnits: 1,
      isDefault: true,
    },
  });
  count('cancellation_policies');

  const commission = await prisma.commissionRule.create({
    data: { studioId: studio.id, name: 'Seans Basi Sabit Ucret', type: CommissionType.PER_SESSION_FIXED, value: 450 },
  });
  count('commission_rules');

  const rtOda = await prisma.resourceType.create({
    data: { studioId: studio.id, name: 'Tedavi Odasi', selectableByMember: false },
  });
  count('resource_types');

  const odalar = [];
  for (let i = 1; i <= 2; i += 1) {
    const oda = await prisma.resource.create({
      data: { studioId: studio.id, branchId: branch.id, resourceTypeId: rtOda.id, name: `Tedavi Odasi ${i}`, capacity: 1 },
    });
    count('resources');
    odalar.push(oda);
  }

  const measurementForm = await prisma.measurementFormTemplate.create({
    data: {
      studioId: studio.id,
      businessTypeTemplateId,
      name: 'Fizyoterapi Degerlendirme Formu',
      fields: [
        { key: 'postur', label: 'Postur', type: 'text' },
        { key: 'agri_skoru', label: 'Agri Skoru (0-10)', type: 'number', min: 0, max: 10 },
        { key: 'notlar', label: 'Notlar', type: 'text' },
      ],
    },
  });
  count('measurement_form_templates');

  const svcDegerlendirme = await prisma.serviceType.create({
    data: {
      studioId: studio.id,
      name: 'Degerlendirme',
      durationMin: 60,
      capacity: 1,
      allowedEntitlementKinds: [EntitlementKind.SESSION_COUNT],
      cancellationPolicyId: policy.id,
      commissionRuleId: commission.id,
    },
  });
  count('service_types');
  await prisma.serviceTypeResourceType.create({
    data: { serviceTypeId: svcDegerlendirme.id, resourceTypeId: rtOda.id, quantity: 1 },
  });
  count('service_type_resource_types');

  const svcSeans = await prisma.serviceType.create({
    data: {
      studioId: studio.id,
      name: 'Seans',
      durationMin: 45,
      capacity: 1,
      requiresQualification: true,
      prerequisiteFormId: measurementForm.id,
      allowedEntitlementKinds: [EntitlementKind.SESSION_COUNT],
      cancellationPolicyId: policy.id,
      commissionRuleId: commission.id,
    },
  });
  count('service_types');
  await prisma.serviceTypeResourceType.create({
    data: { serviceTypeId: svcSeans.id, resourceTypeId: rtOda.id, quantity: 1 },
  });
  count('service_type_resource_types');

  const pkgSeans = await prisma.packageDefinition.create({
    data: {
      studioId: studio.id,
      name: '8 Seans Fizyoterapi Paketi',
      entitlementKind: EntitlementKind.SESSION_COUNT,
      totalUnits: 8,
      validityDays: 90,
      price: 9600,
      freezeDaysAllowed: 14,
    },
  });
  count('package_definitions');
  await prisma.packageDefinitionService.createMany({
    data: [
      { packageDefinitionId: pkgSeans.id, serviceTypeId: svcDegerlendirme.id, unitCost: 1 },
      { packageDefinitionId: pkgSeans.id, serviceTypeId: svcSeans.id, unitCost: 1 },
    ],
  });
  count('package_definition_services', 2);

  const owner = await createUserWithMembership({
    studioId: studio.id,
    roleTemplateId: scaffold.roleTemplateIds.owner,
    firstName: 'Ozge',
    lastName: 'Aydemir',
    passwordHash,
  });
  await grantKvkkConsent(owner.membershipId, kvkkDocId);
  demoLogins.push({ label: 'Denge Fizyoterapi - Sahip (Ozge Aydemir)', phone: owner.phone });

  const reception = await createUserWithMembership({
    studioId: studio.id,
    roleTemplateId: scaffold.roleTemplateIds.reception,
    firstName: 'Ceren',
    lastName: 'Ozdemir',
    passwordHash,
  });
  await grantKvkkConsent(reception.membershipId, kvkkDocId);

  const trainerNames: [string, string][] = [
    ['Ahmet', 'Korkmaz'],
    ['Nilay', 'Sonmez'],
  ];
  const trainerProfiles: string[] = [];
  for (const [firstName, lastName] of trainerNames) {
    const t = await createUserWithMembership({
      studioId: studio.id,
      roleTemplateId: scaffold.roleTemplateIds.trainer,
      firstName,
      lastName,
      passwordHash,
    });
    const profile = await prisma.trainerProfile.create({
      data: { membershipId: t.membershipId, studioId: studio.id, commissionRuleId: commission.id },
    });
    count('trainer_profiles');
    await prisma.trainerQualification.createMany({
      data: [
        { trainerProfileId: profile.id, serviceTypeId: svcDegerlendirme.id },
        { trainerProfileId: profile.id, serviceTypeId: svcSeans.id },
      ],
    });
    count('trainer_qualifications', 2);
    trainerProfiles.push(profile.id);
  }

  const members: { userId: string; memberProfileId: string; firstName: string }[] = [];
  const memberNames: [string, string, string | null][] = [
    ['Hande', 'Cetin', 'Kronik bel agrisi, oturarak calisiyor.'],
    ['Kaan', 'Bulut', null],
    ['Melis', 'Ergin', 'Diz meniskus ameliyati gecirdi.'],
    ['Tarik', 'Ozkaya', null],
    ['Asli', 'Gunes', null],
  ];
  for (const [firstName, lastName, medical] of memberNames) {
    const created = await createUserWithMembership({
      studioId: studio.id,
      roleTemplateId: scaffold.roleTemplateIds.member,
      firstName,
      lastName,
      passwordHash,
    });
    const profile = await prisma.memberProfile.create({
      data: { membershipId: created.membershipId, studioId: studio.id, medicalConditions: medical },
    });
    count('member_profiles');
    await grantKvkkConsent(created.membershipId, kvkkDocId);
    members.push({ userId: created.userId, memberProfileId: profile.id, firstName });
  }

  const patient = members[0];
  const patientPackage = await sellPackage(studio.id, patient.memberProfileId, pkgSeans, 1);

  const degerlendirmeSlot = daysFromNow(1, 10);
  const scheduleDegerlendirme = await prisma.sessionSchedule.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      serviceTypeId: svcDegerlendirme.id,
      resourceId: odalar[0].id,
      trainerId: trainerProfiles[0],
      title: 'Degerlendirme',
      startTime: degerlendirmeSlot,
      endTime: addMinutes(degerlendirmeSlot, 60),
      capacity: 1,
    },
  });
  count('session_schedules');

  const seansSlot = daysFromNow(3, 14);
  const scheduleSeans = await prisma.sessionSchedule.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      serviceTypeId: svcSeans.id,
      resourceId: odalar[1].id,
      trainerId: trainerProfiles[1],
      title: 'Seans',
      startTime: seansSlot,
      endTime: addMinutes(seansSlot, 45),
      capacity: 1,
    },
  });
  count('session_schedules');

  await prisma.booking.create({
    data: {
      studioId: studio.id,
      scheduleId: scheduleDegerlendirme.id,
      memberId: patient.memberProfileId,
      memberPackageId: patientPackage.id,
      status: BookingStatus.ATTENDED,
      unitsCharged: 1,
      checkInAt: degerlendirmeSlot,
    },
  });
  count('bookings');
  await prisma.sessionSchedule.update({ where: { id: scheduleDegerlendirme.id }, data: { bookedCount: 1 } });

  await prisma.booking.create({
    data: {
      studioId: studio.id,
      scheduleId: scheduleSeans.id,
      memberId: patient.memberProfileId,
      memberPackageId: patientPackage.id,
      status: BookingStatus.CONFIRMED,
      unitsCharged: 1,
    },
  });
  count('bookings');
  await prisma.sessionSchedule.update({ where: { id: scheduleSeans.id }, data: { bookedCount: 1 } });

  await prisma.measurementEntry.create({
    data: {
      studioId: studio.id,
      memberId: patient.memberProfileId,
      formTemplateId: measurementForm.id,
      values: { postur: 'Hafif kifoz', agri_skoru: 4, notlar: 'Ilk degerlendirme, egzersiz plani baslatildi.' },
      recordedByUserId: owner.userId,
    },
  });
  count('measurement_entries');

  await prisma.expense.create({
    data: {
      studioId: studio.id,
      branchId: branch.id,
      category: 'Sarf Malzeme',
      amount: 950,
      spentAt: daysFromNow(-2, 9),
      note: 'Kinesio bant ve tedavi malzemeleri',
      createdByUserId: owner.userId,
    },
  });
  count('expenses');

  return { studioId: studio.id, roleTemplateIds: scaffold.roleTemplateIds };
}

// ---------------------------------------------------------------------------
// Cross-tenant identity: same phone/user, member at Zen and trainer at Guc PT
// ---------------------------------------------------------------------------

async function linkCrossTenantIdentity(
  zen: ZenResult,
  guc: {
    studioId: string;
    trainerRoleTemplateId: string;
    serviceTypeIds: string[];
    commissionRuleId: string;
    roleTemplateIds: Record<string, string>;
  },
  passwordHash: string,
) {
  const phone = nextPhone();
  const user = await prisma.user.create({
    data: {
      phone,
      firstName: 'Cansu',
      lastName: 'Erol',
      passwordHash,
      phoneVerifiedAt: new Date(),
    },
  });
  count('users');
  demoLogins.push({ label: 'Cansu Erol - Zen uye + Guc PT egitmen (ayni kullanici)', phone });

  const zenMembership = await prisma.membership.create({
    data: {
      userId: user.id,
      studioId: zen.studioId,
      roleTemplateId: zen.roleTemplateIds.member,
      status: MembershipStatus.ACTIVE,
      joinedAt: new Date(),
    },
  });
  count('memberships');
  await prisma.memberProfile.create({
    data: { membershipId: zenMembership.id, studioId: zen.studioId },
  });
  count('member_profiles');

  const gucMembership = await prisma.membership.create({
    data: {
      userId: user.id,
      studioId: guc.studioId,
      roleTemplateId: guc.trainerRoleTemplateId,
      status: MembershipStatus.ACTIVE,
      joinedAt: new Date(),
    },
  });
  count('memberships');
  const trainerProfile = await prisma.trainerProfile.create({
    data: {
      membershipId: gucMembership.id,
      studioId: guc.studioId,
      bio: 'Istanbul ve Ankara arasinda haftalik seyahat eden misafir egitmen.',
      commissionRuleId: guc.commissionRuleId,
    },
  });
  count('trainer_profiles');
  await prisma.trainerQualification.createMany({
    data: guc.serviceTypeIds.map((serviceTypeId) => ({ trainerProfileId: trainerProfile.id, serviceTypeId })),
  });
  count('trainer_qualifications', guc.serviceTypeIds.length);
}

// ---------------------------------------------------------------------------
// Packages, payments, bookings with resources
// ---------------------------------------------------------------------------

async function sellPackage(
  studioId: string,
  memberId: string,
  packageDefinition: { id: string; entitlementKind: EntitlementKind; totalUnits: number | null; validityDays: number; price: any },
  usedUnits: number,
) {
  const startDate = daysFromNow(-7, 9);
  const endDate = new Date(startDate.getTime() + packageDefinition.validityDays * 24 * 60 * 60 * 1000);
  const remainingUnits =
    packageDefinition.entitlementKind === EntitlementKind.TIME_UNLIMITED
      ? null
      : (packageDefinition.totalUnits ?? 0) - usedUnits;

  const memberPackage = await prisma.memberPackage.create({
    data: {
      studioId,
      memberId,
      packageDefinitionId: packageDefinition.id,
      entitlementKind: packageDefinition.entitlementKind,
      totalUnits: packageDefinition.totalUnits,
      usedUnits,
      remainingUnits,
      status: PackageStatus.ACTIVE,
      startDate,
      endDate,
    },
  });
  count('member_packages');

  await prisma.payment.create({
    data: {
      studioId,
      memberId,
      memberPackageId: memberPackage.id,
      amount: packageDefinition.price,
      paymentMethod: PaymentMethod.CREDIT_CARD_POS,
      paymentStatus: PaymentStatus.COMPLETED,
      receiptNumber: `POS-${Math.floor(Math.random() * 900000 + 100000)}`,
      paidAt: startDate,
    },
  });
  count('payments');

  return memberPackage;
}

async function bookWithResource(opts: {
  studioId: string;
  scheduleId: string;
  memberId: string;
  memberPackageId: string | null;
  unitsCharged: number;
  resourceId: string;
  startTime: Date;
  endTime: Date;
}) {
  const booking = await prisma.booking.create({
    data: {
      studioId: opts.studioId,
      scheduleId: opts.scheduleId,
      memberId: opts.memberId,
      memberPackageId: opts.memberPackageId,
      status: BookingStatus.CONFIRMED,
      unitsCharged: opts.unitsCharged,
    },
  });
  count('bookings');

  await prisma.bookingResource.create({
    data: {
      studioId: opts.studioId,
      bookingId: booking.id,
      resourceId: opts.resourceId,
      startTime: opts.startTime,
      endTime: opts.endTime,
      exclusive: true,
    },
  });
  count('booking_resources');

  if (opts.memberPackageId && opts.unitsCharged > 0) {
    await prisma.memberPackage.update({
      where: { id: opts.memberPackageId },
      data: {
        usedUnits: { increment: opts.unitsCharged },
        remainingUnits: { decrement: opts.unitsCharged },
      },
    });
  }

  return booking;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary() {
  console.log('');
  console.log('Ornek veri yuklemesi tamamlandi.');
  console.log('');
  console.log('Tablo bazinda kayit sayilari:');
  for (const [table, n] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${table}: ${n}`);
  }
  console.log('');
  console.log('Demo giris telefonlari:');
  for (const login of demoLogins) {
    console.log(`  ${login.label}: ${login.phone}`);
  }
  console.log('');
  console.log(
    // The password itself is never printed (CodeQL: clear-text logging).
    'Sifre: SEED_DEMO_PASSWORD ortam degiskeni; verilmemisse seed.ts icindeki varsayilan gelistirme sifresi.',
  );
}

main()
  .catch((error) => {
    console.error('Seed calisirken hata olustu:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
