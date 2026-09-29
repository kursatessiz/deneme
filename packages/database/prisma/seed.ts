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
import {
  DEFAULT_ROLE_TEMPLATES,
  ALL_PERMISSIONS,
  normalizePhone,
  DEFAULT_PIPELINE_STAGES,
  THEME_FAMILIES,
  BadgeKind,
  BUILTIN_TEMPLATES,
  BUILTIN_TEMPLATE_LOCALES,
  builtinTemplateContent,
  AUTOMATION_RULE_TYPES,
  LEGACY_RULE_TEMPLATE_KEY,
  legacyRuleToJourney,
  legacyTemplateRule,
  winBackSegmentRules,
  computeCartTotals,
  defaultRetailTaxRate,
  formatReceiptNumber,
} from '@platform/shared';
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
  'community_reactions',
  'community_comments',
  'community_post_tiers',
  'community_posts',
  'access_tier_rules',
  'access_tiers',
  'platform_credit_ledger',
  'studio_referrals',
  'platform_billing_payments',
  'platform_billing_settings',
  'sale_refund_lines',
  'sale_refunds',
  'sale_lines',
  'sales',
  'stock_movements',
  'stock_levels',
  'products',
  'product_categories',
  'retail_settings',
  'event_registrations',
  'event_ticket_types',
  'event_occurrences',
  'events',
  'loyalty_redemptions',
  'loyalty_ledger',
  'loyalty_accounts',
  'loyalty_rewards',
  'loyalty_rules',
  'loyalty_settings',
  'ai_usage',
  'ai_translation_job_items',
  'ai_translation_jobs',
  'ai_glossary_terms',
  'ai_settings',
  'health_sync_records',
  'health_daily_summaries',
  'member_health_settings',
  'journey_step_runs',
  'journey_enrollments',
  'journeys',
  'campaign_recipients',
  'campaigns',
  'segment_members',
  'segments',
  'contact_consents',
  'automation_runs',
  'automation_rules',
  'communication_consents',
  'notification_logs',
  'message_templates',
  'message_tracking_events',
  'message_links',
  'message_suppressions',
  'conversation_messages',
  'conversations',
  'saved_replies',
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
  'plan_prices',
  'platform_referral_reward_amounts',
  'plans',
  'business_type_templates',
  'company_info',
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
  // Separate, optional consent for the health integration (W21): never part
  // of onboarding's required documents, only shown when the member opts in.
  await prisma.documentVersion.create({
    data: {
      studioId: null,
      type: DocumentType.HEALTH_DATA,
      version: 1,
      title: 'Saglik Verisi Paylasimi Acik Riza Metni',
      body:
        'Bu metin, Apple Health / Health Connect entegrasyonu ile adim, aktif enerji ve ' +
        'dinlenme nabzi gunluk ozetlerinizin isletmeyle paylasilmasina iliskin acik riza ' +
        'metninin ornek bir taslagidir. Ozel nitelikli kisisel veri oldugundan onay her zaman ' +
        'geri alinabilir ve veri her zaman silinebilir. Gercek kullanimdan once hukuk ' +
        'danismani tarafindan gozden gecirilmelidir.',
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

  const platformStudioId = await seedCrm(zen.studioId, flow.studioId);
  await seedGrowth(zen.studioId);
  await seedLoyalty(zen.studioId);
  await seedEvents(zen.studioId);
  await seedRetail(zen.studioId);
  await seedPayouts(zen.studioId);
  await seedCommunity(zen.studioId);
  await seedSites(platformStudioId);
  await seedPlatformBilling(zen.studioId, businessTypeTemplates.personal_training, plans.starter, kvkkDoc.id, passwordHash);

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
    await createDefaultJourneys(studioId);
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

/**
 * Default journeys for a tenant (G2a): the six former automation rule types
 * from the shared template gallery. Everything is a draft except the
 * booking reminder, which already had an equivalent tenant setting
 * (Studio.reminderHoursBefore) so it is safe to run by default. Win-back
 * gets its own dynamic audience segment.
 */
async function createDefaultJourneys(studioId: string) {
  for (const type of AUTOMATION_RULE_TYPES) {
    const rule = legacyTemplateRule(type);
    let winBackSegmentId: string | undefined;
    if (type === 'WIN_BACK') {
      const segment = await prisma.segment.create({
        data: {
          studioId,
          name: 'Geri kazanma kitlesi',
          kind: 'DYNAMIC',
          rules: winBackSegmentRules({ type: 'WIN_BACK', noAttendanceDays: 30, requireNoActivePackage: true }) as unknown as Prisma.InputJsonValue,
        },
      });
      count('segments');
      winBackSegmentId = segment.id;
    }
    const active = type === 'BOOKING_REMINDER';
    await prisma.journey.create({
      data: {
        studioId,
        name: JOURNEY_NAMES[type],
        status: active ? 'ACTIVE' : 'DRAFT',
        activatedAt: active ? new Date() : null,
        definition: legacyRuleToJourney(rule, { winBackSegmentId }) as unknown as Prisma.InputJsonValue,
        templateKey: LEGACY_RULE_TEMPLATE_KEY[type],
        legacyRuleType: type,
      },
    });
    count('journeys');
  }
}

/** Tenant data (journey names belong to the tenant, like service names). */
const JOURNEY_NAMES: Record<(typeof AUTOMATION_RULE_TYPES)[number], string> = {
  BOOKING_REMINDER: 'Seans hatırlatması',
  PACKAGE_EXPIRING: 'Paket bitiş hatırlatması',
  WIN_BACK: 'Geri kazanma',
  BIRTHDAY: 'Doğum günü mesajı',
  FIRST_CLASS_FOLLOW_UP: 'İlk seans sonrası takip',
  NO_SHOW_FOLLOW_UP: 'Gelmeyene takip',
};

/**
 * Demo loyalty program for Zen (G3a, docs/SADAKAT.md): 12-month expiry,
 * member self-redeem on, one rule per earning source, four rewards and a
 * little history for the first three members. Rule and reward names are
 * tenant data. History rows follow the ledger contract (running balance,
 * one idempotency key per row, cached account balance).
 */
async function seedLoyalty(zenStudioId: string) {
  const studio = await prisma.studio.findUniqueOrThrow({ where: { id: zenStudioId }, select: { currency: true } });
  await prisma.loyaltySettings.create({
    data: { studioId: zenStudioId, enabled: true, expiryMode: 'MONTHS_AFTER_EARN', expiryMonths: 12, expiryNoticeDays: 14, memberRedeemEnabled: true },
  });
  count('loyalty_settings');

  const rules = [
    { kind: 'ATTENDANCE', name: 'Seansa katılım', points: 10 },
    { kind: 'PURCHASE_AMOUNT', name: 'Paket satın alma', points: 1, perAmount: new Prisma.Decimal(10), currency: studio.currency },
    { kind: 'REFERRAL', name: 'Arkadaşını getir', points: 100 },
    { kind: 'BIRTHDAY', name: 'Doğum günü hediyesi', points: 50 },
    { kind: 'BADGE', name: 'Yeni rozet', points: 25 },
    { kind: 'MANUAL', name: 'İşletme yorumu', points: 30 },
  ];
  for (const rule of rules) {
    await prisma.loyaltyRule.create({ data: { studioId: zenStudioId, ...rule } });
    count('loyalty_rules');
  }

  const rewards = [
    { type: 'GIFT', name: 'Havlu hediyesi', costPoints: 100, description: 'Resepsiyondan teslim alınır' },
    { type: 'DISCOUNT_PERCENT', name: 'Yüzde 10 indirim', costPoints: 300, value: new Prisma.Decimal(10) },
    { type: 'EXTRA_SESSION_CREDIT', name: 'Bir seans hakkı', costPoints: 400, value: new Prisma.Decimal(1) },
    { type: 'DISCOUNT_AMOUNT', name: 'Tutar indirimi', costPoints: 500, value: new Prisma.Decimal(100), currency: studio.currency },
  ];
  const created: { id: string; name: string; type: string; costPoints: number }[] = [];
  for (const reward of rewards) {
    created.push(await prisma.loyaltyReward.create({ data: { studioId: zenStudioId, ...reward } }));
    count('loyalty_rewards');
  }
  const gift = created[0];

  const members = await prisma.memberProfile.findMany({
    where: { studioId: zenStudioId, membership: { status: MembershipStatus.ACTIVE, isPartnerGuest: false } },
    orderBy: { createdAt: 'asc' },
    take: 3,
    select: { membershipId: true },
  });
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const [index, member] of members.entries()) {
    const history: { delta: number; reason: string; sourceType: string; key: string; note: string; daysAgo: number }[] = [
      { delta: 50, reason: 'MANUAL_ADJUST', sourceType: 'manual', key: 'welcome', note: 'Hoş geldin puanı', daysAgo: 60 },
      { delta: 120 + index * 40, reason: 'MANUAL_ADJUST', sourceType: 'manual', key: 'campaign', note: 'Yaz kampanyası katılımı', daysAgo: 30 },
    ];
    if (index === 0) history.push({ delta: -gift.costPoints, reason: 'REDEEM', sourceType: 'redemption', key: 'gift', note: gift.name, daysAgo: 10 });

    let balance = 0;
    let earned = 0;
    let redeemed = 0;
    let nextExpiryAt: Date | null = null;
    for (const row of history) {
      balance += row.delta;
      const createdAt = new Date(now - row.daysAgo * dayMs);
      const expiresAt = row.delta > 0 ? new Date(createdAt.getTime() + 365 * dayMs) : null;
      if (expiresAt && (!nextExpiryAt || expiresAt < nextExpiryAt)) nextExpiryAt = expiresAt;
      if (row.delta > 0) earned += row.delta;
      const entry = await prisma.loyaltyLedger.create({
        data: {
          studioId: zenStudioId,
          membershipId: member.membershipId,
          delta: row.delta,
          balanceAfter: balance,
          reason: row.reason,
          sourceType: row.sourceType,
          sourceId: `seed:${member.membershipId}:${row.key}`,
          expiresAt,
          note: row.note,
          createdAt,
        },
      });
      count('loyalty_ledger');
      if (row.reason === 'REDEEM') {
        redeemed += -row.delta;
        await prisma.loyaltyRedemption.create({
          data: {
            studioId: zenStudioId,
            membershipId: member.membershipId,
            rewardId: gift.id,
            ledgerId: entry.id,
            rewardName: gift.name,
            type: gift.type,
            pointsSpent: gift.costPoints,
            createdAt,
          },
        });
        count('loyalty_redemptions');
      }
    }
    await prisma.loyaltyAccount.create({
      data: { studioId: zenStudioId, membershipId: member.membershipId, balance, lifetimeEarned: earned, lifetimeRedeemed: redeemed, nextExpiryAt },
    });
    count('loyalty_accounts');
  }
}

/**
 * Demo events for Zen (G3c-1, docs/ETKINLIKLER.md): a public one-off
 * workshop with a paid ticket and a members-only ticket payable with
 * package credits, and a members-only four-week course. Titles, ticket
 * names and prices are tenant data. Two members are already registered for
 * the workshop (desk payment), so the counters start consistent.
 */
async function seedEvents(zenStudioId: string) {
  const studio = await prisma.studio.findUniqueOrThrow({ where: { id: zenStudioId }, select: { currency: true } });
  const branch = await prisma.branch.findFirst({ where: { studioId: zenStudioId }, orderBy: { sortOrder: 'asc' } });
  const serviceType = await prisma.serviceType.findFirst({ where: { studioId: zenStudioId, isActive: true }, orderBy: { createdAt: 'asc' } });
  const dayMs = 24 * 60 * 60 * 1000;
  const at = (daysAhead: number, hour: number) => {
    const d = new Date(Date.now() + daysAhead * dayMs);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };

  const workshopStart = at(10, 7);
  const workshopEnd = at(10, 10);
  const workshop = await prisma.event.create({
    data: {
      studioId: zenStudioId,
      branchId: branch?.id ?? null,
      title: 'Hafta sonu atölyesi',
      description: 'Üç saatlik uygulamalı atölye. Yeni başlayanlar ve deneyimliler için uygundur.',
      kind: 'SINGLE',
      status: 'PUBLISHED',
      capacity: 12,
      waitlistEnabled: true,
      visibility: 'PUBLIC',
      startsAt: workshopStart,
      endsAt: workshopEnd,
      fullRefundHoursBefore: 48,
      publishedAt: new Date(),
    },
  });
  count('events');
  await prisma.eventOccurrence.create({ data: { studioId: zenStudioId, eventId: workshop.id, startsAt: workshopStart, endsAt: workshopEnd } });
  count('event_occurrences');
  const standard = await prisma.eventTicketType.create({
    data: { studioId: zenStudioId, eventId: workshop.id, name: 'Standart bilet', priceAmount: new Prisma.Decimal(750), currency: studio.currency, sortOrder: 0 },
  });
  count('event_ticket_types');
  await prisma.eventTicketType.create({
    data: {
      studioId: zenStudioId,
      eventId: workshop.id,
      name: 'Üye bileti',
      priceAmount: new Prisma.Decimal(600),
      currency: studio.currency,
      membersOnly: true,
      creditServiceTypeId: serviceType?.id ?? null,
      creditUnits: serviceType ? 1 : null,
      sortOrder: 1,
    },
  });
  count('event_ticket_types');

  const members = await prisma.memberProfile.findMany({
    where: { studioId: zenStudioId, membership: { status: MembershipStatus.ACTIVE, isPartnerGuest: false } },
    orderBy: { createdAt: 'asc' },
    take: 2,
    select: { id: true },
  });
  for (const member of members) {
    const payment = await prisma.payment.create({
      data: {
        studioId: zenStudioId,
        memberId: member.id,
        branchId: branch?.id ?? null,
        amount: standard.priceAmount,
        currency: studio.currency,
        paymentMethod: PaymentMethod.CASH,
        paymentStatus: PaymentStatus.COMPLETED,
        metadata: { eventId: workshop.id, ticketTypeId: standard.id },
      },
    });
    count('payments');
    await prisma.eventRegistration.create({
      data: {
        studioId: zenStudioId,
        eventId: workshop.id,
        ticketTypeId: standard.id,
        memberId: member.id,
        status: 'CONFIRMED',
        source: 'STAFF',
        dedupeKey: `m:${member.id}`,
        amountDue: standard.priceAmount,
        amountPaid: standard.priceAmount,
        currency: studio.currency,
        paymentId: payment.id,
        paymentMethod: 'CASH',
      },
    });
    count('event_registrations');
  }
  await prisma.event.update({ where: { id: workshop.id }, data: { seatsTaken: members.length } });
  await prisma.eventTicketType.update({ where: { id: standard.id }, data: { soldCount: members.length } });

  const courseOccurrences = [0, 1, 2, 3].map((week) => ({ startsAt: at(7 + week * 7, 16), endsAt: at(7 + week * 7, 17) }));
  const course = await prisma.event.create({
    data: {
      studioId: zenStudioId,
      branchId: branch?.id ?? null,
      title: 'Başlangıç kursu (4 hafta)',
      description: 'Dört hafta boyunca haftada bir buluşan küçük grup kursu.',
      kind: 'SERIES',
      status: 'PUBLISHED',
      capacity: 8,
      waitlistEnabled: true,
      visibility: 'MEMBERS_ONLY',
      startsAt: courseOccurrences[0].startsAt,
      endsAt: courseOccurrences[courseOccurrences.length - 1].endsAt,
      fullRefundHoursBefore: 72,
      publishedAt: new Date(),
    },
  });
  count('events');
  await prisma.eventOccurrence.createMany({ data: courseOccurrences.map((o) => ({ studioId: zenStudioId, eventId: course.id, ...o })) });
  count('event_occurrences', courseOccurrences.length);
  await prisma.eventTicketType.create({
    data: { studioId: zenStudioId, eventId: course.id, name: 'Kurs ücreti', priceAmount: new Prisma.Decimal(2400), currency: studio.currency },
  });
  count('event_ticket_types');
}

/**
 * G5b community feed for Zen (docs/TOPLULUK.md): two access tiers, a pinned
 * announcement for every active member, a post only for the unlimited
 * package holders, a file post, a draft, and one comment and like.
 */
async function seedCommunity(zenStudioId: string) {
  const ownerMembership = await prisma.membership.findFirstOrThrow({
    where: { studioId: zenStudioId, roleTemplate: { isOwner: true } },
    orderBy: { createdAt: 'asc' },
  });
  const unlimited = await prisma.packageDefinition.findFirstOrThrow({
    where: { studioId: zenStudioId, entitlementKind: EntitlementKind.TIME_UNLIMITED },
    orderBy: { createdAt: 'asc' },
  });

  const everyone = await prisma.accessTier.create({
    data: {
      studioId: zenStudioId,
      name: 'Tüm aktif üyeler',
      description: 'İşletmenin her aktif üyesi',
      rules: { create: [{ studioId: zenStudioId, kind: 'ACTIVE_MEMBER' }] },
    },
  });
  count('access_tiers');
  const unlimitedTier = await prisma.accessTier.create({
    data: {
      studioId: zenStudioId,
      name: 'Sınırsız üyelik sahipleri',
      description: 'Aktif sınırsız paketi olan üyeler',
      rules: { create: [{ studioId: zenStudioId, kind: 'PACKAGE_DEFINITION', packageDefinitionId: unlimited.id }] },
    },
  });
  count('access_tiers');
  count('access_tier_rules', 2);

  const dayMs = 24 * 60 * 60 * 1000;
  const announcement = await prisma.communityPost.create({
    data: {
      studioId: zenStudioId,
      type: 'ANNOUNCEMENT',
      status: 'PUBLISHED',
      title: 'Bayram haftası çalışma saatleri',
      body: 'Bayram haftası boyunca seanslar sabah 09.00 ile akşam 18.00 arasında yapılacaktır. Takvimdeki güncel saatleri kontrol etmeyi unutmayın.',
      pinned: true,
      authorMembershipId: ownerMembership.id,
      publishedAt: new Date(Date.now() - 2 * dayMs),
    },
  });
  await prisma.communityPost.create({
    data: {
      studioId: zenStudioId,
      type: 'POST',
      status: 'PUBLISHED',
      title: 'Sınırsız üyelere özel: ay sonu buluşması',
      body: 'Ay sonunda sınırsız üyelik sahiplerine özel bir tanışma buluşması yapıyoruz. Katılmak isteyenler resepsiyona haber verebilir.',
      authorMembershipId: ownerMembership.id,
      publishedAt: new Date(Date.now() - dayMs),
      tiers: { create: [{ tierId: unlimitedTier.id, studioId: zenStudioId }] },
    },
  });
  await prisma.communityPost.create({
    data: {
      studioId: zenStudioId,
      type: 'FILE',
      status: 'PUBLISHED',
      title: 'Yeni dönem ders programı',
      body: 'Yeni dönemin haftalık programını aşağıdaki bağlantıdan indirebilirsiniz.',
      attachmentUrl: 'https://example.com/ornek-program.pdf',
      attachmentName: 'Haftalık program (PDF)',
      authorMembershipId: ownerMembership.id,
      publishedAt: new Date(Date.now() - 3 * dayMs),
      tiers: { create: [{ tierId: everyone.id, studioId: zenStudioId }] },
    },
  });
  await prisma.communityPost.create({
    data: {
      studioId: zenStudioId,
      type: 'POST',
      status: 'DRAFT',
      title: 'Taslak: yaz kampı duyurusu',
      body: 'Yaz kampı ayrıntıları netleşince yayınlanacak.',
      authorMembershipId: ownerMembership.id,
    },
  });
  count('community_posts', 4);
  count('community_post_tiers', 2);

  const member = await prisma.memberProfile.findFirst({
    where: { studioId: zenStudioId, membership: { status: MembershipStatus.ACTIVE, isPartnerGuest: false } },
    orderBy: { createdAt: 'asc' },
    select: { membershipId: true },
  });
  if (member) {
    await prisma.communityComment.create({
      data: { studioId: zenStudioId, postId: announcement.id, authorMembershipId: member.membershipId, body: 'Bilgi için teşekkürler.' },
    });
    count('community_comments');
    await prisma.communityReaction.create({ data: { studioId: zenStudioId, postId: announcement.id, membershipId: member.membershipId } });
    count('community_reactions');
  }
}

/**
 * Demo segments and a campaign draft for Zen (G2a). Segment counts are
 * filled by the first scheduler heartbeat (refreshedAt is still null).
 */
async function seedGrowth(zenStudioId: string) {
  const members = await prisma.segment.create({
    data: {
      studioId: zenStudioId,
      name: 'Aktif üyeler',
      description: 'Yaşam döngüsü aşaması aktif olan herkes',
      kind: 'DYNAMIC',
      rules: { combinator: 'and', rules: [{ field: 'contact.lifecycleStage', op: 'in', value: ['MEMBER'] }] },
    },
  });
  await prisma.segment.create({
    data: {
      studioId: zenStudioId,
      name: 'Ticari izni olan adaylar',
      kind: 'DYNAMIC',
      rules: {
        combinator: 'and',
        rules: [
          { field: 'contact.lifecycleStage', op: 'in', value: ['LEAD', 'TRIAL'] },
          { field: 'consent.commercialAllowed', op: 'is_true' },
        ],
      },
    },
  });
  count('segments', 2);
  await prisma.campaign.create({
    data: { studioId: zenStudioId, name: 'Sonbahar dönemi duyurusu', segmentId: members.id, templateKey: 'WIN_BACK' },
  });
  count('campaigns');
}

// Global default templates: every built-in template (packages/shared
// message-templates.ts) in every bundled language (tr, en) for SMS, WhatsApp
// and email. Texts come from the i18n catalogue (namespace msgTpl), so the
// seed and the engine's built-in fallback can never disagree. Win-back and
// birthday are marketing (isTransactional: false, İYS consent required).
async function createGlobalMessageTemplates() {
  for (const t of BUILTIN_TEMPLATES) {
    for (const locale of BUILTIN_TEMPLATE_LOCALES) {
      for (const channel of ['SMS', 'WHATSAPP', 'EMAIL'] as const) {
        const content = builtinTemplateContent(t.key, channel, locale);
        if (!content) continue;
        await prisma.messageTemplate.create({
          data: {
            studioId: null,
            key: t.key,
            channel,
            locale,
            body: content.body,
            subject: content.subject,
            blocks: content.blocks ? (content.blocks as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
            whatsappTemplateName: content.whatsappTemplateName,
            whatsappStatus: 'APPROVED',
            isTransactional: content.isTransactional,
          },
        });
        count('message_templates');
      }
    }
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
  // G5c-1b: one monthly price per platform billing currency (plan_prices).
  // plans.price_monthly/currency are the deprecated mirror of the TRY price
  // kept for one release; nothing reads them to choose a price.
  const plans = [
    {
      key: 'starter',
      name: 'Starter',
      prices: { TRY: 1490, USD: 49, EUR: 45, GBP: 39 },
      limits: { maxBranches: 1, maxActiveMembers: 150, maxStaff: 5, aiMonthlyBudgetCents: 500 },
    },
    {
      key: 'pro',
      name: 'Pro',
      prices: { TRY: 3490, USD: 119, EUR: 109, GBP: 95 },
      limits: { maxBranches: 3, maxActiveMembers: 800, maxStaff: 25, aiMonthlyBudgetCents: 2000 },
    },
  ];
  const ids: Record<string, string> = {};
  for (const plan of plans) {
    const created = await prisma.plan.create({
      data: {
        key: plan.key,
        name: plan.name,
        priceMonthly: plan.prices.TRY,
        currency: 'TRY',
        trialDays: 14,
        limits: plan.limits,
        prices: { create: Object.entries(plan.prices).map(([currency, priceMonthly]) => ({ currency, priceMonthly })) },
      },
    });
    ids[plan.key] = created.id;
    count('plans');
    count('plan_prices', Object.keys(plan.prices).length);
  }
  return { starter: ids.starter, pro: ids.pro };
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

// ---------------------------------------------------------------------------
// G1b: CRM. The platform tenant, a few legacy lead rows, then the exact data
// migration SQL (crm_backfill_contacts, created by the
// 20260929000000_crm_attribution migration) so a fresh database gets default
// pipeline stages and contacts the same way a migrated production database
// did. The legacy `leads` rows are written here only to exercise that
// migration; the application no longer writes them.
// ---------------------------------------------------------------------------

/** Legacy lead phones the API e2e suite asserts on (crm-migration.e2e-spec.ts). */
const SEED_LEAD_PHONES = {
  open: '+905399960001',
  flowTrial: '+905399960002',
} as const;

async function seedCrm(zenStudioId: string, flowStudioId: string): Promise<string> {
  const platform = await prisma.studio.create({
    data: { name: 'Platform', slug: 'platform', isPlatform: true },
  });
  count('studios');

  const zenMembers = await prisma.membership.findMany({
    where: { studioId: zenStudioId, memberProfile: { isNot: null } },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });
  const [memberA, memberB] = zenMembers;

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const open = await prisma.lead.create({
    data: {
      studioId: zenStudioId,
      fullName: 'Seda  Nur Aksoy',
      phone: SEED_LEAD_PHONES.open,
      openPhone: SEED_LEAD_PHONES.open,
      email: 'seda.aksoy@example.com',
      source: 'WEB_FORM',
      stage: 'CONTACTED',
      utmSource: 'instagram',
      utmMedium: 'paid_social',
      utmCampaign: 'tr_tr_pilates_lead_202609',
      createdAt: new Date(now - 5 * day),
    },
  });
  // An older, closed lead for the same phone: folds into the same contact.
  const older = await prisma.lead.create({
    data: {
      studioId: zenStudioId,
      fullName: 'Seda Aksoy',
      phone: SEED_LEAD_PHONES.open,
      openPhone: null,
      source: 'WALK_IN',
      stage: 'LOST',
      lostReason: 'Zamani uygun degildi',
      createdAt: new Date(now - 120 * day),
      updatedAt: new Date(now - 110 * day),
    },
  });
  await prisma.leadActivity.createMany({
    data: [
      { leadId: open.id, studioId: zenStudioId, type: 'CALL', body: 'Arandi, fiyat bilgisi verildi' },
      { leadId: older.id, studioId: zenStudioId, type: 'NOTE', body: 'Eski basvuru' },
    ],
  });
  if (memberA && memberB) {
    // A lead for someone who is already a member: linked to the membership.
    await prisma.lead.create({
      data: {
        studioId: zenStudioId,
        fullName: `${memberA.user.firstName} ${memberA.user.lastName}`,
        phone: memberA.user.phone,
        openPhone: memberA.user.phone,
        source: 'PHONE',
        stage: 'NEW',
      },
    });
    // A converted (WON) lead.
    await prisma.lead.create({
      data: {
        studioId: zenStudioId,
        fullName: `${memberB.user.firstName} ${memberB.user.lastName}`,
        phone: memberB.user.phone,
        openPhone: null,
        source: 'REFERRAL',
        stage: 'WON',
        convertedMembershipId: memberB.id,
      },
    });
  }
  await prisma.lead.create({
    data: {
      studioId: flowStudioId,
      fullName: 'Kerem Tas',
      phone: SEED_LEAD_PHONES.flowTrial,
      openPhone: SEED_LEAD_PHONES.flowTrial,
      source: 'INSTAGRAM',
      stage: 'TRIAL_BOOKED',
    },
  });
  count('leads', memberA && memberB ? 5 : 3);

  await prisma.$executeRawUnsafe('SELECT crm_backfill_contacts()');
  count('pipeline_stages', await prisma.pipelineStage.count());
  count('contacts', await prisma.contact.count());

  return platform.id;
}

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

// ---------------------------------------------------------------------------
// G2c: page engine - platform site (corporate + legal pages, sector landings)
// ---------------------------------------------------------------------------

interface SeedBlock {
  type: string;
  data: unknown;
}

interface SeedLocale {
  locale: string;
  slug: string;
  seoTitle: string;
  seoDescription?: string;
  legalApproved?: boolean;
}

async function createPublishedPage(
  siteId: string,
  kind: 'HOME' | 'LANDING' | 'CORPORATE' | 'LEGAL',
  internalLabel: string,
  locales: SeedLocale[],
  blocksByLocaleKey: (locale: string) => SeedBlock[] | null,
  sectorKey: string | null = null,
): Promise<void> {
  // blocksByLocaleKey returns the same ordered block list for every locale
  // (blocks carry all locales' text at once); called once to build it.
  const blocks = blocksByLocaleKey(locales[0].locale) ?? [];

  const page = await prisma.page.create({
    data: { siteId, kind, sectorKey, internalLabel, status: 'PUBLISHED', publishedAt: new Date() },
  });
  count('pages');

  const localeRows = await Promise.all(
    locales.map((l) =>
      prisma.pageLocale.create({
        data: {
          pageId: page.id,
          siteId,
          locale: l.locale,
          slug: l.slug,
          seoTitle: l.seoTitle,
          seoDescription: l.seoDescription ?? null,
          legalApproved: l.legalApproved ?? false,
          legalApprovedAt: l.legalApproved ? new Date() : null,
        },
      }),
    ),
  );
  count('page_locales', locales.length);

  const blockRows = await Promise.all(
    blocks.map((b, i) => prisma.block.create({ data: { pageId: page.id, type: b.type, position: i, data: b.data as Prisma.InputJsonValue } })),
  );
  count('blocks', blocks.length);

  await prisma.pageVersion.create({
    data: {
      pageId: page.id,
      version: 1,
      snapshot: {
        locales: localeRows.map((l) => ({
          locale: l.locale,
          slug: l.slug,
          seoTitle: l.seoTitle,
          seoDescription: l.seoDescription,
          ogImageUrl: l.ogImageUrl,
          legalApproved: l.legalApproved,
          legalApprovedAt: l.legalApprovedAt?.toISOString() ?? null,
        })),
        blocks: blockRows.map((b) => ({ id: b.id, type: b.type, position: b.position, abVariantKey: b.abVariantKey, data: b.data })),
      } as unknown as Prisma.InputJsonValue,
    },
  });
  count('page_versions');
}

async function seedSites(platformStudioId: string): Promise<void> {
  const site = await prisma.site.create({
    data: { studioId: platformStudioId, kind: 'PLATFORM', defaultLocale: 'tr', enabledLocales: ['tr', 'en'] },
  });
  count('sites');

  await prisma.companyInfo.create({
    data: {
      id: 'platform',
      legalName: 'Platform Yazilim Anonim Sirketi',
      address: 'Maslak Mahallesi, Buyukdere Caddesi No:1, Sariyer/Istanbul',
      tradeRegistryNo: '123456',
      mersisNo: '0123456789000010',
      taxOffice: 'Maslak',
      taxNumber: '1234567890',
      email: 'iletisim@platform.example',
      phone: '+902121234567',
      socialLinks: { instagram: 'https://instagram.com/platform', linkedin: 'https://linkedin.com/company/platform' },
    },
  });
  count('company_info');

  // Home
  await createPublishedPage(site.id, 'HOME', 'Ana sayfa', [
    { locale: 'tr', slug: '', seoTitle: 'Platform | Uyelik ve randevu yonetimi', seoDescription: 'Studyolar, kisisel antrenorluk, fizyoterapi ve benzeri isletmeler icin tek platform.' },
    { locale: 'en', slug: '', seoTitle: 'Platform | Membership and booking management', seoDescription: 'One platform for studios, personal training, physiotherapy and similar businesses.' },
  ], () => [
    {
      type: 'hero',
      data: {
        config: {},
        text: {
          tr: { title: 'Uyelik ve randevu tabanli isletmeniz icin tek platform', subtitle: 'Takvim, paket/kredi yonetimi, odeme ve raporlama; kod degisikligi gerektirmeden isletmenize gore yapilandirilir.', primaryCtaLabel: 'Ucretsiz deneyin', primaryCtaHref: '#iletisim' },
          en: { title: 'The all-in-one platform for membership and booking businesses', subtitle: 'Scheduling, packages, payments and reporting, configured for your business without code changes.', primaryCtaLabel: 'Start free trial', primaryCtaHref: '#contact' },
        },
      },
    },
    {
      type: 'sector_cards',
      data: { config: { sectorKeys: [] }, text: { tr: { title: 'Isletme turunuzu secin' }, en: { title: 'Choose your business type' } } },
    },
    {
      type: 'feature_grid',
      data: {
        config: {},
        text: {
          tr: {
            title: 'Ozellikler',
            items: [
              { title: 'Online rezervasyon', description: 'Uyeler seans ve randevularini kendi telefonlarindan planlar.' },
              { title: 'Paket ve kredi takibi', description: 'Seans sayisi, sinirsiz sure veya kredi tabanli paketler.' },
              { title: 'Odeme ve raporlama', description: 'Tahsilat, iade ve gelir raporlari tek ekrandan.' },
            ],
          },
          en: {
            title: 'Features',
            items: [
              { title: 'Online booking', description: 'Members schedule sessions and appointments from their phone.' },
              { title: 'Packages and credits', description: 'Session count, unlimited time or credit based packages.' },
              { title: 'Payments and reporting', description: 'Collections, refunds and revenue reports in one place.' },
            ],
          },
        },
      },
    },
    { type: 'cta', data: { config: {}, text: { tr: { title: 'Isletmenizi kaydedin', buttonLabel: 'Iletisime gecin', buttonHref: '#iletisim' }, en: { title: 'Register your business', buttonLabel: 'Contact us', buttonHref: '#contact' } } } },
    { type: 'lead_form', data: { config: { fields: ['fullName', 'phone', 'email'] }, text: { tr: { title: 'Iletisim', submitLabel: 'Gonder' }, en: { title: 'Contact', submitLabel: 'Send' } } } },
  ]);

  // Corporate pages
  await createPublishedPage(site.id, 'CORPORATE', 'Ozellikler', [
    { locale: 'tr', slug: 'ozellikler', seoTitle: 'Ozellikler' },
    { locale: 'en', slug: 'features', seoTitle: 'Features' },
  ], () => [
    { type: 'feature_grid', data: { config: {}, text: { tr: { title: 'Ozellikler', items: [{ title: 'Takvim', description: 'Seans ve kaynak yonetimi.' }, { title: 'Odeme', description: 'Tahsilat ve fatura.' }] }, en: { title: 'Features', items: [{ title: 'Scheduling', description: 'Sessions and resource management.' }, { title: 'Payments', description: 'Collections and invoicing.' }] } } } },
  ]);

  await createPublishedPage(site.id, 'CORPORATE', 'Fiyatlandirma', [
    { locale: 'tr', slug: 'fiyatlandirma', seoTitle: 'Fiyatlandirma' },
    { locale: 'en', slug: 'pricing', seoTitle: 'Pricing' },
  ], () => [
    { type: 'pricing', data: { config: { hidden: false }, text: { tr: { title: 'Planlar' }, en: { title: 'Plans' } } } },
  ]);

  await createPublishedPage(site.id, 'CORPORATE', 'SSS', [
    { locale: 'tr', slug: 'sss', seoTitle: 'Sikca Sorulan Sorular' },
    { locale: 'en', slug: 'faq', seoTitle: 'Frequently Asked Questions' },
  ], () => [
    {
      type: 'faq',
      data: {
        config: {},
        text: {
          tr: { items: [{ question: 'Kurulum ne kadar surer?', answer: 'Isletmenizi birkac dakika icinde kaydedip kullanmaya baslayabilirsiniz.' }, { question: 'Verilerim guvende mi?', answer: 'Tum veriler sifrelenmis baglanti uzerinden tasinir ve kiracilar arasinda izole edilir.' }] },
          en: { items: [{ question: 'How long does setup take?', answer: 'You can register your business and start using it within minutes.' }, { question: 'Is my data secure?', answer: 'All data travels over encrypted connections and is isolated between tenants.' }] },
        },
      },
    },
  ]);

  await createPublishedPage(site.id, 'CORPORATE', 'Hakkimizda', [
    { locale: 'tr', slug: 'hakkimizda', seoTitle: 'Hakkimizda' },
    { locale: 'en', slug: 'about', seoTitle: 'About' },
  ], () => [
    { type: 'legal_text', data: { config: {}, text: { tr: { title: 'Hakkimizda', body: 'Platform, uyelik ve randevu tabanli isletmelerin gunluk operasyonunu tek yerden yonetmesini saglar.' }, en: { title: 'About', body: 'Platform lets membership and booking based businesses run their daily operations from one place.' } } } },
  ]);

  await createPublishedPage(site.id, 'CORPORATE', 'Iletisim', [
    { locale: 'tr', slug: 'iletisim', seoTitle: 'Iletisim' },
    { locale: 'en', slug: 'contact', seoTitle: 'Contact' },
  ], () => [
    { type: 'contact', data: { config: { showAddress: true, showPhone: true, showEmail: true }, text: { tr: { title: 'Bize ulasin' }, en: { title: 'Get in touch' } } } },
    { type: 'lead_form', data: { config: { fields: ['fullName', 'phone', 'email', 'interest'] }, text: { tr: { title: 'Mesaj gonderin', submitLabel: 'Gonder' }, en: { title: 'Send a message', submitLabel: 'Send' } } } },
  ]);

  // Legal pages (drafts pending legal review, per docs/SAYFA_MOTORU.md)
  const legalPages: Array<{ label: string; slugTr: string; slugEn: string; titleTr: string; titleEn: string; bodyTr: string; bodyEn: string }> = [
    {
      label: 'KVKK Aydinlatma Metni',
      slugTr: 'kvkk-aydinlatma-metni',
      slugEn: 'privacy-notice-tr',
      titleTr: 'KVKK Aydinlatma Metni',
      titleEn: 'Turkish Data Protection Notice (KVKK)',
      bodyTr:
        'Veri sorumlusu [SIRKET UNVANI] olarak, 6698 sayili Kisisel Verilerin Korunmasi Kanunu kapsaminda kisisel verileriniz; hizmet sunumu, iletisim ve yasal yukumluluklerin yerine getirilmesi amaciyla islenir.\n\n' +
        'Verileriniz; barindirma hizmeti saglayicimiz, Cloudflare (icerik dagitim ve guvenlik), odeme kuruluslari (Stripe, iyzico veya PayTR), mesajlasma saglayicilarimiz (Twilio, Netgsm veya Ileti Merkezi) ve Amazon SES (e-posta gonderimi) ile, yalnizca hizmetin gerektirdigi olcude paylasilabilir.\n\n' +
        'Bu metin bir taslaktir ve hukuk danismani tarafindan gozden gecirilmeden yayinlanmamalidir.',
      bodyEn:
        'As the data controller [COMPANY LEGAL NAME], we process your personal data under Turkish Law No. 6698 for service delivery, communication and legal obligations.\n\n' +
        'Your data may be shared, only to the extent the service requires, with our hosting provider, Cloudflare (content delivery and security), payment processors (Stripe, iyzico or PayTR), messaging providers (Twilio, Netgsm or Ileti Merkezi) and Amazon SES (email delivery).\n\n' +
        'This text is a draft and must not be published without legal counsel review.',
    },
    {
      label: 'Gizlilik Politikasi',
      slugTr: 'gizlilik-politikasi',
      slugEn: 'privacy-policy',
      titleTr: 'Gizlilik Politikasi',
      titleEn: 'Privacy Policy',
      bodyTr: 'Bu gizlilik politikasi hangi verileri topladigimizi, neden topladigimizi ve nasil koruduğumuzu aciklar. Bu metin bir taslaktir ve hukuk danismani tarafindan gozden gecirilmeden yayinlanmamalidir.',
      bodyEn: 'This privacy policy explains what data we collect, why, and how we protect it. This text is a draft and must not be published without legal counsel review.',
    },
    {
      label: 'Cerez Politikasi',
      slugTr: 'cerez-politikasi',
      slugEn: 'cookie-policy',
      titleTr: 'Cerez Politikasi',
      titleEn: 'Cookie Policy',
      bodyTr: 'Sitemiz, analiz ve reklam icin yalnizca aciktan onay verdiginizde birinci taraf cerezler kullanir. Bu metin bir taslaktir ve hukuk danismani tarafindan gozden gecirilmeden yayinlanmamalidir.',
      bodyEn: 'Our site uses first-party cookies for analytics and advertising only once you explicitly consent. This text is a draft and must not be published without legal counsel review.',
    },
    {
      label: 'Kullanim Kosullari',
      slugTr: 'kullanim-kosullari',
      slugEn: 'terms-of-use',
      titleTr: 'Kullanim Kosullari',
      titleEn: 'Terms of Use',
      bodyTr: 'Bu platformu kullanarak asagidaki kosullari kabul etmis olursunuz. Bu metin bir taslaktir ve hukuk danismani tarafindan gozden gecirilmeden yayinlanmamalidir.',
      bodyEn: 'By using this platform you agree to the following terms. This text is a draft and must not be published without legal counsel review.',
    },
  ];

  for (const lp of legalPages) {
    await createPublishedPage(
      site.id,
      'LEGAL',
      lp.label,
      [
        { locale: 'tr', slug: lp.slugTr, seoTitle: lp.titleTr, legalApproved: false },
        { locale: 'en', slug: lp.slugEn, seoTitle: lp.titleEn, legalApproved: false },
      ],
      () => [{ type: 'legal_text', data: { config: {}, text: { tr: { title: lp.titleTr, body: lp.bodyTr }, en: { title: lp.titleEn, body: lp.bodyEn } } } }],
    );
  }

  // Sector landing pages (at least two, generated in the same spirit as the
  // super admin "Landing sayfasi olustur" wizard: docs/SAYFA_MOTORU.md).
  const sectorLandings: Array<{ sectorKey: string; nameTr: string; nameEn: string; slug: string; memberTr: string }> = [
    { sectorKey: 'pilates_studio', nameTr: 'Pilates Studyosu', nameEn: 'Pilates Studio', slug: 'pilates', memberTr: 'Uye' },
    { sectorKey: 'personal_training', nameTr: 'Personal Training', nameEn: 'Personal Training', slug: 'personal-training', memberTr: 'Danisan' },
  ];
  for (const s of sectorLandings) {
    await createPublishedPage(
      site.id,
      'LANDING',
      `${s.nameTr} - Landing`,
      [
        { locale: 'tr', slug: s.slug, seoTitle: `${s.nameTr} Yazilimi | Platform`, seoDescription: `${s.nameTr} isletmeniz icin randevu, paket ve odeme yonetimi.` },
        { locale: 'en', slug: s.slug, seoTitle: `${s.nameEn} Software | Platform`, seoDescription: `Booking, packages and payments for your ${s.nameEn.toLowerCase()} business.` },
      ],
      () => [
        {
          type: 'hero',
          data: {
            config: {},
            text: {
              tr: { title: `${s.nameTr} isletmeniz icin tek platform`, subtitle: `${s.memberTr} yonetimi, takvim, paket ve odeme bir arada.`, primaryCtaLabel: 'Ucretsiz deneyin', primaryCtaHref: '#iletisim' },
              en: { title: `The all-in-one platform for your ${s.nameEn}`, subtitle: 'Scheduling, packages, payments and reporting in one place.', primaryCtaLabel: 'Start free trial', primaryCtaHref: '#contact' },
            },
          },
        },
        { type: 'cta', data: { config: {}, text: { tr: { title: 'Hemen baslayin', buttonLabel: 'Iletisime gecin', buttonHref: '#iletisim' }, en: { title: 'Get started today', buttonLabel: 'Contact us', buttonHref: '#contact' } } } },
        { type: 'lead_form', data: { config: { fields: ['fullName', 'phone'] }, text: { tr: { title: 'Bize ulasin', submitLabel: 'Gonder' }, en: { title: 'Contact us', submitLabel: 'Send' } } } },
      ],
      s.sectorKey,
    );
  }
}

main()
  .catch((error) => {
    console.error('Seed calisirken hata olustu:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Demo store for Zen (G3c-2, docs/PERAKENDE.md): three categories, a few
 * desk products priced in the studio's own currency (never a hard-coded
 * one), stock received at both branches through the ledger, one product
 * below its low-stock threshold and one walk-in sale with its receipt
 * number. Product names and prices are tenant data.
 */
async function seedRetail(zenStudioId: string) {
  const studio = await prisma.studio.findUniqueOrThrow({
    where: { id: zenStudioId },
    select: { currency: true, pricesIncludeTax: true, taxRegime: true, invoiceSettings: { select: { defaultVatRate: true } } },
  });
  const defaultRate = defaultRetailTaxRate(studio.taxRegime, studio.invoiceSettings ? studio.invoiceSettings.defaultVatRate.toString() : null);
  const branches = await prisma.branch.findMany({ where: { studioId: zenStudioId, isActive: true }, orderBy: { createdAt: 'asc' } });
  const owner = await prisma.membership.findFirstOrThrow({ where: { studioId: zenStudioId, roleTemplate: { isOwner: true } }, select: { userId: true } });

  await prisma.retailSettings.create({ data: { studioId: zenStudioId, allowBackorder: false, receiptPrefix: 'S', lastReceiptSeq: 0 } });
  count('retail_settings');

  const categoryNames = ['İçecekler', 'Aksesuar', 'Beslenme'];
  const categories: Record<string, string> = {};
  for (const [index, name] of categoryNames.entries()) {
    categories[name] = (await prisma.productCategory.create({ data: { studioId: zenStudioId, name, sortOrder: index } })).id;
    count('product_categories');
  }

  const products = [
    { name: 'Su 500 ml', category: 'İçecekler', sku: 'SU-500', barcode: '8690000000017', price: '25.00', cost: '8.00', taxRate: null, threshold: 10, stock: [48, 24] },
    { name: 'Havlu', category: 'Aksesuar', sku: 'HAVLU-01', barcode: '8690000000024', price: '180.00', cost: '70.00', taxRate: null, threshold: 5, stock: [12, 6] },
    { name: 'Kaymaz çorap', category: 'Aksesuar', sku: 'CORAP-01', barcode: '8690000000031', price: '250.00', cost: '90.00', taxRate: null, threshold: 5, stock: [3, 10] },
    { name: 'Protein bar', category: 'Beslenme', sku: 'BAR-01', barcode: '8690000000048', price: '60.00', cost: '25.00', taxRate: '10', threshold: 8, stock: [30, 0] },
    { name: 'Havlu kiralama', category: 'Aksesuar', sku: 'HAVLU-KIRA', barcode: null, price: '40.00', cost: null, taxRate: null, threshold: null, stock: null },
  ];
  const created: { id: string; name: string; sku: string | null; price: string; cost: string | null; taxRate: string | null; tracked: boolean }[] = [];
  for (const p of products) {
    const product = await prisma.product.create({
      data: {
        studioId: zenStudioId,
        categoryId: categories[p.category],
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        price: new Prisma.Decimal(p.price),
        currency: studio.currency,
        taxRate: p.taxRate ? new Prisma.Decimal(p.taxRate) : null,
        costPrice: p.cost ? new Prisma.Decimal(p.cost) : null,
        trackStock: p.stock !== null,
        lowStockThreshold: p.threshold,
      },
    });
    count('products');
    created.push({ id: product.id, name: p.name, sku: p.sku, price: p.price, cost: p.cost, taxRate: p.taxRate, tracked: p.stock !== null });
    if (!p.stock) continue;
    for (const [index, branch] of branches.entries()) {
      const quantity = p.stock[index] ?? 0;
      if (quantity <= 0) continue;
      await prisma.stockLevel.create({ data: { studioId: zenStudioId, productId: product.id, branchId: branch.id, quantity } });
      count('stock_levels');
      await prisma.stockMovement.create({
        data: {
          studioId: zenStudioId,
          productId: product.id,
          branchId: branch.id,
          type: 'RECEIVE',
          quantity,
          quantityAfter: quantity,
          reason: 'Açılış stoku',
          unitCost: p.cost ? new Prisma.Decimal(p.cost) : null,
          actorUserId: owner.userId,
        },
      });
      count('stock_movements');
    }
  }

  // One walk-in sale at the first branch: two waters and a towel rental, cash.
  const branch = branches[0];
  const water = created[0];
  const rental = created[4];
  const lines = [
    { product: water, quantity: 2 },
    { product: rental, quantity: 1 },
  ];
  const totals = computeCartTotals({
    currency: studio.currency,
    pricesIncludeTax: studio.pricesIncludeTax,
    lines: lines.map((l) => ({ unitPrice: l.product.price, quantity: l.quantity, taxRate: l.product.taxRate ?? defaultRate })),
  });
  const receiptNumber = formatReceiptNumber('S', 1);
  const sale = await prisma.sale.create({
    data: {
      studioId: zenStudioId,
      branchId: branch.id,
      receiptSeq: 1,
      receiptNumber,
      currency: studio.currency,
      pricesIncludeTax: studio.pricesIncludeTax,
      subtotal: new Prisma.Decimal(totals.subtotal),
      discountTotal: new Prisma.Decimal(totals.discountTotal),
      netTotal: new Prisma.Decimal(totals.netTotal),
      taxTotal: new Prisma.Decimal(totals.taxTotal),
      total: new Prisma.Decimal(totals.total),
      paymentMethod: PaymentMethod.CASH,
      soldByUserId: owner.userId,
    },
  });
  count('sales');
  await prisma.saleLine.createMany({
    data: lines.map((l, i) => ({
      studioId: zenStudioId,
      saleId: sale.id,
      position: i,
      productId: l.product.id,
      productName: l.product.name,
      sku: l.product.sku,
      stockTracked: l.product.tracked,
      quantity: l.quantity,
      unitPrice: new Prisma.Decimal(l.product.price),
      unitCost: l.product.cost ? new Prisma.Decimal(l.product.cost) : null,
      taxRate: new Prisma.Decimal(l.product.taxRate ?? defaultRate),
      netAmount: new Prisma.Decimal(totals.lines[i].netAmount),
      taxAmount: new Prisma.Decimal(totals.lines[i].taxAmount),
      total: new Prisma.Decimal(totals.lines[i].total),
    })),
  });
  count('sale_lines');
  const level = await prisma.stockLevel.update({
    where: { productId_branchId: { productId: water.id, branchId: branch.id } },
    data: { quantity: { decrement: 2 } },
  });
  await prisma.stockMovement.create({
    data: {
      studioId: zenStudioId,
      productId: water.id,
      branchId: branch.id,
      type: 'SALE',
      quantity: -2,
      quantityAfter: level.quantity,
      reference: receiptNumber,
      saleId: sale.id,
      actorUserId: owner.userId,
    },
  });
  count('stock_movements');
  await prisma.retailSettings.update({ where: { studioId: zenStudioId }, data: { lastReceiptSeq: 1 } });
}

// ---------------------------------------------------------------------------
// G5c-1: platform billing - demo tenants ACTIVE, one extra tenant TRIALING
// (docs/DENEME_VE_ETKINLESTIRME.md)
// ---------------------------------------------------------------------------

/** Fixed so the Playwright trial spec can log in as this owner. */
const SEED_TRIAL_OWNER_PHONE = '+905329900001';
/** Zen's business referral code; the trial tenant below was referred with it. */
const SEED_ZEN_REFERRAL_CODE = 'ZENREF23';

async function seedPlatformBilling(
  zenStudioId: string,
  businessTypeTemplateId: string,
  planId: string,
  kvkkDocId: string,
  passwordHash: string,
) {
  // Every demo tenant created above is a paying (ACTIVE) customer.
  await prisma.studio.updateMany({
    where: { isPlatform: false },
    data: { billingStatus: 'ACTIVE', activatedAt: daysFromNow(-60, 9), billingStatusChangedAt: daysFromNow(-60, 9) },
  });
  await prisma.studio.update({ where: { id: zenStudioId }, data: { platformReferralCode: SEED_ZEN_REFERRAL_CODE } });

  await prisma.platformBillingSettings.create({ data: { id: 'platform', referralRewardKind: 'FREE_MONTHS', referralRewardMonths: 1 } });
  count('platform_billing_settings');

  // One extra business in its free trial, 10 days left.
  const trialStart = daysFromNow(-4, 9);
  const trialEnd = daysFromNow(10, 9);
  const studio = await prisma.studio.create({
    data: {
      businessTypeTemplateId,
      name: 'Nova Hareket Merkezi',
      slug: 'nova-hareket-merkezi',
      phone: '+905321110005',
      email: 'merhaba@novahareket.example',
      themeFamily: THEME_FAMILIES.saha.key,
      themePrimary: '#1F5A7A',
      gradientPresetKey: THEME_FAMILIES.saha.gradients[0].key,
      billingStatus: 'TRIALING',
      trialStartedAt: trialStart,
      trialEndsAt: trialEnd,
      billingStatusChangedAt: trialStart,
    },
  });
  count('studios');

  const scaffold = await scaffoldTenant(studio.id, planId, 100);
  // scaffoldTenant writes an ACTIVE subscription; a trial tenant's is TRIALING until the trial end.
  await prisma.subscription.updateMany({
    where: { studioId: studio.id },
    data: { status: SubscriptionStatus.TRIALING, currentPeriodStart: trialStart, currentPeriodEnd: trialEnd },
  });

  await prisma.branch.create({ data: { studioId: studio.id, name: 'Merkez', phone: studio.phone } });
  count('branches');
  // Default CRM pipeline stages, as every tenant has (seedCrm ran before this tenant existed).
  await prisma.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((s) => ({ studioId: studio.id, key: s.key, kind: s.kind, sortOrder: s.sortOrder, isSystem: true })),
    skipDuplicates: true,
  });
  count('pipeline_stages', DEFAULT_PIPELINE_STAGES.length);

  const user = await prisma.user.create({
    data: {
      phone: SEED_TRIAL_OWNER_PHONE,
      email: null,
      firstName: 'Deniz',
      lastName: 'Kaya',
      passwordHash,
      phoneVerifiedAt: new Date(),
    },
  });
  count('users');
  const membership = await prisma.membership.create({
    data: {
      userId: user.id,
      studioId: studio.id,
      roleTemplateId: scaffold.roleTemplateIds.owner,
      status: MembershipStatus.ACTIVE,
      joinedAt: trialStart,
    },
  });
  count('memberships');
  await grantKvkkConsent(membership.id, kvkkDocId);
  demoLogins.push({ label: 'Nova Hareket Merkezi - Sahip, deneme surumunde (Deniz Kaya)', phone: SEED_TRIAL_OWNER_PHONE });

  // Nova signed up through Zen's referral code: Zen is rewarded when Nova pays.
  await prisma.studioReferral.create({
    data: { referrerStudioId: zenStudioId, referredStudioId: studio.id, code: SEED_ZEN_REFERRAL_CODE, source: 'MANUAL', status: 'SIGNED_UP' },
  });
  count('studio_referrals');
}

/**
 * Demo bank payouts for Zen (G5d-2, docs/BANKA_ODEMELERI.md), as the MOCK
 * provider would deliver them, in the studio's own currency: a fully
 * matched payout, a partially matched one (one charge has no payment of
 * ours) and a pending one that has not been reconciled. Payment rows carry
 * provider MOCK and the provider reference the payout items are matched on.
 */
async function seedPayouts(zenStudioId: string) {
  const studio = await prisma.studio.findUniqueOrThrow({ where: { id: zenStudioId }, select: { currency: true } });
  const currency = studio.currency;
  const member = await prisma.memberProfile.findFirstOrThrow({ where: { studioId: zenStudioId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  const dayMs = 24 * 60 * 60 * 1000;
  const daysAgo = (n: number, hour = 10) => {
    const d = new Date(Date.now() - n * dayMs);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };

  const charges = [
    { ref: 'mock_chg_seed_a1', amount: '1200.00', fee: '34.80', daysAgo: 12 },
    { ref: 'mock_chg_seed_a2', amount: '800.00', fee: '23.20', daysAgo: 12 },
    { ref: 'mock_chg_seed_b1', amount: '950.00', fee: '27.55', daysAgo: 5 },
    { ref: 'mock_chg_seed_c1', amount: '600.00', fee: '17.40', daysAgo: 0 },
  ];
  const paymentIds = new Map<string, string>();
  for (const c of charges) {
    // One charge of the partial payout and the pending payout's charge have no payment of ours on purpose.
    if (c.ref === 'mock_chg_seed_b1' || c.ref === 'mock_chg_seed_c1') continue;
    const payment = await prisma.payment.create({
      data: {
        studioId: zenStudioId,
        memberId: member.id,
        amount: c.amount,
        refundedAmount: c.ref === 'mock_chg_seed_a2' ? '150.00' : '0',
        currency,
        paymentMethod: PaymentMethod.ONLINE_STRIPE,
        paymentStatus: PaymentStatus.COMPLETED,
        provider: 'MOCK',
        providerReference: c.ref,
        receiptNumber: `MOCK-${c.ref.slice(-2).toUpperCase()}`,
        paidAt: daysAgo(c.daysAgo),
      },
    });
    paymentIds.set(c.ref, payment.id);
    count('payments');
  }
  const b2 = await prisma.payment.create({
    data: {
      studioId: zenStudioId,
      memberId: member.id,
      amount: '450.00',
      currency,
      paymentMethod: PaymentMethod.ONLINE_STRIPE,
      paymentStatus: PaymentStatus.COMPLETED,
      provider: 'MOCK',
      providerReference: 'mock_chg_seed_b2',
      receiptNumber: 'MOCK-B2',
      paidAt: daysAgo(5),
    },
  });
  paymentIds.set('mock_chg_seed_b2', b2.id);
  count('payments');

  const money = (minor: bigint) => {
    const negative = minor < 0n;
    const abs = negative ? -minor : minor;
    return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  };
  const minorOf = (amount: string) => {
    const [whole, fraction = ''] = amount.replace('-', '').split('.');
    const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
    return amount.startsWith('-') ? -value : value;
  };

  interface SeedItem {
    type: 'CHARGE' | 'REFUND';
    ref: string;
    related?: string;
    amount: string;
    fee: string;
    at: Date;
  }
  const payouts: { id: string; status: 'PAID' | 'PENDING'; arrivalDaysAgo: number; items: SeedItem[] }[] = [
    {
      id: 'mock_po_seed_a',
      status: 'PAID',
      arrivalDaysAgo: 11,
      items: [
        { type: 'CHARGE', ref: 'mock_chg_seed_a1', amount: '1200.00', fee: '34.80', at: daysAgo(12) },
        { type: 'CHARGE', ref: 'mock_chg_seed_a2', amount: '800.00', fee: '23.20', at: daysAgo(12, 11) },
        { type: 'REFUND', ref: 'mock_rfnd_seed_a2', related: 'mock_chg_seed_a2', amount: '-150.00', fee: '0.00', at: daysAgo(12, 15) },
      ],
    },
    {
      id: 'mock_po_seed_b',
      status: 'PAID',
      arrivalDaysAgo: 4,
      items: [
        { type: 'CHARGE', ref: 'mock_chg_seed_b1', amount: '950.00', fee: '27.55', at: daysAgo(5) },
        { type: 'CHARGE', ref: 'mock_chg_seed_b2', amount: '450.00', fee: '13.05', at: daysAgo(5, 12) },
      ],
    },
    {
      id: 'mock_po_seed_c',
      status: 'PENDING',
      arrivalDaysAgo: -1,
      items: [{ type: 'CHARGE', ref: 'mock_chg_seed_c1', amount: '600.00', fee: '17.40', at: daysAgo(0) }],
    },
  ];

  for (const p of payouts) {
    let gross = 0n;
    let fees = 0n;
    let refunds = 0n;
    let net = 0n;
    let matched = 0;
    for (const item of p.items) {
      const amount = minorOf(item.amount);
      const fee = minorOf(item.fee);
      net += amount - fee;
      fees += fee;
      if (item.type === 'CHARGE') gross += amount;
      else refunds += -amount;
      if (paymentIds.has(item.related ?? item.ref)) matched += 1;
    }
    const total = p.items.length;
    const payout = await prisma.payout.create({
      data: {
        studioId: zenStudioId,
        provider: 'MOCK',
        providerPayoutId: p.id,
        status: p.status,
        arrivalDate: daysAgo(p.arrivalDaysAgo, 0),
        grossAmount: money(gross),
        feeAmount: money(fees),
        refundAmount: money(refunds),
        netAmount: money(net),
        currency,
        itemCount: total,
        matchableItemCount: total,
        matchedItemCount: matched,
        reconciliationStatus: matched === total ? 'MATCHED' : matched === 0 ? 'UNMATCHED' : 'PARTIAL',
      },
    });
    count('payouts');
    for (const item of p.items) {
      const amount = minorOf(item.amount);
      const fee = minorOf(item.fee);
      const paymentId = paymentIds.get(item.related ?? item.ref) ?? null;
      await prisma.payoutItem.create({
        data: {
          studioId: zenStudioId,
          payoutId: payout.id,
          providerItemId: `mock_txn_${item.ref}`,
          type: item.type,
          providerReference: item.ref,
          relatedReference: item.related ?? null,
          amount: money(amount),
          fee: money(fee),
          net: money(amount - fee),
          currency,
          occurredAt: item.at,
          description: item.type === 'CHARGE' ? 'Mock charge' : 'Mock refund',
          paymentId,
          matchSource: paymentId ? 'AUTO' : null,
        },
      });
      count('payout_items');
    }
  }
}
