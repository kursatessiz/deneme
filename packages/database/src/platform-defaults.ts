import { Prisma, DocumentType } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { BadgeKind, BUILTIN_TEMPLATES, BUILTIN_TEMPLATE_LOCALES, PLATFORM_BILLING_CURRENCIES, builtinTemplateContent } from '@platform/shared';
import type { BadgeThresholdParams, PlatformBillingCurrency } from '@platform/shared';

/**
 * Platform-level default data: the catalogue rows the product needs to
 * function on an empty database (business type templates, plans, SMS
 * packages, global documents, message templates and badges, the platform
 * tenant and its site). Single source for both the development seed
 * (prisma/seed.ts) and the production bootstrap command
 * (apps/api/src/cli/bootstrap.ts). Nothing here is demo data: no tenants
 * other than the platform itself, no users, no passwords.
 *
 * The idempotent writers live in ./ensure-platform-defaults.ts.
 */

export interface BusinessTypeTemplateDefault {
  key: string;
  name: string;
  vocabulary: Record<string, string>;
  defaults: { serviceTypeNames: string[]; resourceTypeNames: string[] };
  enabledModules: string[];
}

export const BUSINESS_TYPE_TEMPLATE_DEFAULTS: readonly BusinessTypeTemplateDefault[] = [
  {
    key: 'pilates_studio',
    name: 'Pilates Studyosu',
    vocabulary: { member: 'Uye', trainer: 'Egitmen', client: 'Uye' },
    defaults: {
      serviceTypeNames: ['Birebir Reformer', 'Grup Reformer', 'Mat Pilates'],
      resourceTypeNames: ['Salon', 'Reformer'],
    },
    enabledModules: ['scheduling', 'packages', 'payments', 'waitlist', 'commissions'],
  },
  {
    key: 'personal_training',
    name: 'Personal Training',
    vocabulary: { member: 'Danisan', trainer: 'Antrenor', client: 'Danisan' },
    defaults: {
      serviceTypeNames: ['Birebir PT', 'Duet PT'],
      resourceTypeNames: ['Antrenman Alani'],
    },
    enabledModules: ['scheduling', 'packages', 'payments', 'commissions'],
  },
  {
    key: 'physiotherapy',
    name: 'Fizyoterapi',
    vocabulary: { member: 'Danisan', trainer: 'Fizyoterapist', client: 'Danisan' },
    defaults: {
      serviceTypeNames: ['Degerlendirme', 'Seans'],
      resourceTypeNames: ['Tedavi Odasi'],
    },
    enabledModules: ['scheduling', 'packages', 'payments', 'measurements'],
  },
];

export interface PlanDefault {
  key: string;
  name: string;
  /** G5c-1b: one monthly price per platform billing currency (plan_prices). */
  prices: Partial<Record<PlatformBillingCurrency, number>>;
  trialDays: number;
  limits: Record<string, number>;
}

export const PLAN_DEFAULTS: readonly PlanDefault[] = [
  {
    key: 'starter',
    name: 'Starter',
    prices: { TRY: 1490, USD: 49, EUR: 45, GBP: 39 },
    trialDays: 14,
    limits: { maxBranches: 1, maxActiveMembers: 150, maxStaff: 5, aiMonthlyBudgetCents: 500 },
  },
  {
    key: 'pro',
    name: 'Pro',
    prices: { TRY: 3490, USD: 119, EUR: 109, GBP: 95 },
    trialDays: 14,
    limits: { maxBranches: 3, maxActiveMembers: 800, maxStaff: 25, aiMonthlyBudgetCents: 2000 },
  },
];

/**
 * The plan's prices as plan_prices rows, plus the one price mirrored into
 * the deprecated plans.price_monthly/currency columns: the first currency in
 * PLATFORM_BILLING_CURRENCIES order, the same rule the super admin plan
 * editor (admin-plans.service) uses.
 */
export function planPriceRows(plan: PlanDefault): { rows: { currency: PlatformBillingCurrency; priceMonthly: number }[]; mirror: { currency: PlatformBillingCurrency; priceMonthly: number } } {
  const rows = PLATFORM_BILLING_CURRENCIES.flatMap((currency) => {
    const priceMonthly = plan.prices[currency];
    return priceMonthly === undefined ? [] : [{ currency, priceMonthly }];
  });
  if (rows.length === 0) throw new Error(`Plan default ${plan.key} has no price`);
  return { rows, mirror: rows[0] };
}

export const SMS_PACKAGE_DEFAULTS: readonly { key: string; name: string; credits: number; price: number }[] = [
  { key: 'sms_1000', name: '1.000 SMS Kredisi', credits: 1000, price: 350 },
  { key: 'sms_5000', name: '5.000 SMS Kredisi', credits: 5000, price: 1500 },
  { key: 'sms_10000', name: '10.000 SMS Kredisi', credits: 10000, price: 2750 },
];

/** Global (studioId null) documents, version 1. Draft texts pending legal review. */
export const GLOBAL_DOCUMENT_DEFAULTS: readonly { type: DocumentType; title: string; body: string }[] = [
  {
    type: DocumentType.KVKK_NOTICE,
    title: 'KVKK Aydinlatma Metni',
    body:
      'Bu metin, 6698 sayili Kisisel Verilerin Korunmasi Kanunu kapsaminda uyelerimizin ' +
      'kisisel verilerinin hangi amacla islendigini aciklayan ornek bir taslaktir. Gercek ' +
      'kullanimdan once hukuk danismani tarafindan gozden gecirilmelidir.',
  },
  {
    type: DocumentType.MEMBERSHIP_CONTRACT,
    title: 'Uyelik Sozlesmesi',
    body:
      'Bu sozlesme, uye ile isletme arasindaki paket satin alma, iptal ve devir sartlarini ' +
      'duzenleyen ornek bir taslak metindir. Gercek kullanimdan once hukuk danismani ' +
      'tarafindan gozden gecirilmelidir.',
  },
  // Separate, optional consent for the health integration (W21): never part
  // of onboarding's required documents, only shown when the member opts in.
  {
    type: DocumentType.HEALTH_DATA,
    title: 'Saglik Verisi Paylasimi Acik Riza Metni',
    body:
      'Bu metin, Apple Health / Health Connect entegrasyonu ile adim, aktif enerji ve ' +
      'dinlenme nabzi gunluk ozetlerinizin isletmeyle paylasilmasina iliskin acik riza ' +
      'metninin ornek bir taslagidir. Ozel nitelikli kisisel veri oldugundan onay her zaman ' +
      'geri alinabilir ve veri her zaman silinebilir. Gercek kullanimdan once hukuk ' +
      'danismani tarafindan gozden gecirilmelidir.',
  },
];

export interface BadgeDefault {
  key: string;
  name: string;
  description: string;
  kind: BadgeKind;
  threshold: BadgeThresholdParams;
}

/** W16 gamification: global badge defaults (studioId null), offered to every tenant. */
export const GLOBAL_BADGE_DEFAULTS: readonly BadgeDefault[] = [
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
    description: "Saat 08:00'den önce başlayan bir seansa katıldın.",
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

/**
 * Global default message templates: every built-in template (packages/shared
 * message-templates.ts) in every bundled language for SMS, WhatsApp and
 * email. Texts come from the i18n catalogue (namespace msgTpl), so these
 * rows and the engine's built-in fallback can never disagree.
 */
export function globalMessageTemplateRows(): Prisma.MessageTemplateCreateManyInput[] {
  const rows: Prisma.MessageTemplateCreateManyInput[] = [];
  for (const t of BUILTIN_TEMPLATES) {
    for (const locale of BUILTIN_TEMPLATE_LOCALES) {
      for (const channel of ['SMS', 'WHATSAPP', 'EMAIL'] as const) {
        const content = builtinTemplateContent(t.key, channel, locale);
        if (!content) continue;
        rows.push({
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
        });
      }
    }
  }
  return rows;
}

/**
 * The platform tenant (Studio.isPlatform): the platform's own marketing,
 * CRM and site run through it (CLAUDE.md "Alan modeli"). Looked up by
 * `isPlatform` in conversion.service, public-sites.service,
 * company-info.controller and billing.
 */
export const PLATFORM_TENANT_DEFAULTS = { name: 'Platform', slug: 'platform' } as const;

export const PLATFORM_SITE_DEFAULTS = { kind: 'PLATFORM' as const, defaultLocale: 'tr', enabledLocales: ['tr', 'en'] };

export interface PageLocaleDefault {
  locale: string;
  slug: string;
  seoTitle: string;
  seoDescription?: string;
  legalApproved?: boolean;
}

export interface PageBlockDefault {
  type: string;
  data: unknown;
}

export interface PageDefault {
  kind: 'HOME' | 'LANDING' | 'CORPORATE' | 'LEGAL';
  internalLabel: string;
  sectorKey?: string | null;
  locales: PageLocaleDefault[];
  blocks: PageBlockDefault[];
}

/**
 * The platform site's home page, so `/` (which redirects to it) and the deploy smoke test work on a fresh
 * environment. It carries the content of the former hand-coded landing page (hero, features, steps, sectors);
 * as seed data the copy is plain tenant content, not i18n keys.
 */
export const PLATFORM_HOME_PAGE_DEFAULT: PageDefault = {
  kind: 'HOME',
  internalLabel: 'Ana sayfa',
  locales: [
    { locale: 'tr', slug: '', seoTitle: 'Platform | Uyelik ve randevu yonetimi', seoDescription: 'Studyolar, kisisel antrenorluk, fizyoterapi ve benzeri isletmeler icin tek platform.' },
    { locale: 'en', slug: '', seoTitle: 'Platform | Membership and booking management', seoDescription: 'One platform for studios, personal training, physiotherapy and similar businesses.' },
  ],
  blocks: [
    {
      type: 'hero',
      data: {
        config: {},
        text: {
          tr: {
            eyebrow: 'Üyelik ve randevu tabanlı işletmeler için',
            title: 'Takvim, üyelik ve ödemeler tek panelde.',
            subtitle: 'Seanslarınızı, kapasite sınırlı kaynaklarınızı ve paket kredilerinizi kod değişikliği olmadan kendi iş modelinize göre yönetin. Web paneli ve her rol için tek mobil uygulama.',
            primaryCtaLabel: 'Ücretsiz deneyin',
            primaryCtaHref: '#iletisim',
            secondaryCtaLabel: 'Panele giriş yap',
            secondaryCtaHref: '/giris',
          },
          en: {
            eyebrow: 'For membership and appointment based businesses',
            title: 'Schedule, members and payments in one panel.',
            subtitle: 'Run your sessions, capacity-limited resources and package credits the way your business works, without code changes. A web panel and one mobile app for every role.',
            primaryCtaLabel: 'Start free trial',
            primaryCtaHref: '#contact',
            secondaryCtaLabel: 'Sign in to the panel',
            secondaryCtaHref: '/giris',
          },
        },
      },
    },
    {
      type: 'feature_grid',
      data: {
        config: {},
        text: {
          tr: {
            title: 'Günlük işin tamamı',
            items: [
              { title: 'Takvim ve rezervasyon', description: 'Gün, hafta ve ay görünümü, kaynak ve eğitmen çakışma kontrolü, bekleme listesi ve eğitmen değişikliği.' },
              { title: 'Paket ve kredi', description: 'Seans adedi, süreli sınırsız veya kredi tabanlı haklar; dondurma, transfer ve aile hesabı.' },
              { title: 'Üye kartı ve check-in', description: 'QR ile davet ve giriş, rezervasyon geçmişi, ölçümler, onaylar ve sadakat puanı tek kartta.' },
              { title: 'Ödeme ve hakediş', description: 'Ödemeler, giderler, faturalar ve eğitmen komisyonları kiracının para birimiyle.' },
              { title: 'Mesajlaşma', description: 'WhatsApp, SMS ve e-posta tek motordan; izin ve sessiz saat kontrolüyle.' },
              { title: 'Raporlar', description: 'Doluluk, iptal, gelir ve yenileme oranları; şube bazında karşılaştırma ve dışa aktarma.' },
            ],
          },
          en: {
            title: 'The whole working day',
            items: [
              { title: 'Calendar and booking', description: 'Day, week and month views, resource and trainer conflict checks, waitlists and trainer substitution.' },
              { title: 'Packages and credits', description: 'Session counts, time-based unlimited or credit-based entitlements; freezing, transfers and family accounts.' },
              { title: 'Member card and check-in', description: 'QR invitations and check-in, booking history, measurements, consents and loyalty points on one card.' },
              { title: 'Payments and payouts', description: "Payments, expenses, invoices and trainer commissions in the business's own currency." },
              { title: 'Messaging', description: 'WhatsApp, SMS and email from one engine, with consent and quiet-hour checks.' },
              { title: 'Reports', description: 'Occupancy, cancellations, revenue and renewal rates; per-branch comparison and export.' },
            ],
          },
        },
      },
    },
    {
      type: 'how_it_works',
      data: {
        config: {},
        text: {
          tr: {
            title: 'Nasıl çalışır',
            steps: [
              { title: 'İş türünüzü seçin', description: 'Şablon; hizmet türlerini, kaynakları ve kelime dağarcığını sizin için hazırlar.' },
              { title: 'Hizmet ve paketleri tanımlayın', description: 'Süre, kapasite, iptal politikası ve kredi kuralları sizin verinizdir.' },
              { title: 'Üyelerinizi davet edin', description: 'Ekranda gösterilen QR ya da WhatsApp ve SMS ile gönderilen bağlantıyla.' },
              { title: 'Takvimden yönetin', description: 'Rezervasyon, yoklama, satış ve ödeme aynı panelden.' },
            ],
          },
          en: {
            title: 'How it works',
            steps: [
              { title: 'Pick your business type', description: 'A template prepares service types, resources and vocabulary for you.' },
              { title: 'Define services and packages', description: 'Duration, capacity, cancellation policy and credit rules are your data.' },
              { title: 'Invite your members', description: 'With a QR code on screen or a link sent over WhatsApp and SMS.' },
              { title: 'Run it from the calendar', description: 'Bookings, attendance, sales and payments from the same panel.' },
            ],
          },
        },
      },
    },
    {
      // The cards themselves are generated from the business type templates; the description keeps the full sector list.
      type: 'sector_cards',
      data: {
        config: { sectorKeys: [] },
        text: {
          tr: { title: 'Kimler için', description: 'Pilates ve reformer, Kişisel antrenörlük, Fizyoterapi, Yoga, Wellness ve spa, Dövüş sanatları, Yüzme okulları, Tenis ve padel kortları, Müzik ve dil kursları, Çocuk aktivite merkezleri, Coworking odaları' },
          en: { title: 'Who it is for', description: "Pilates and reformer, Personal training, Physiotherapy, Yoga, Wellness and spa, Martial arts, Swimming schools, Tennis and padel courts, Music and language courses, Children's activity centers, Coworking rooms" },
        },
      },
    },
    { type: 'cta', data: { config: {}, text: { tr: { title: 'Isletmenizi kaydedin', buttonLabel: 'Iletisime gecin', buttonHref: '#iletisim' }, en: { title: 'Register your business', buttonLabel: 'Contact us', buttonHref: '#contact' } } } },
    { type: 'lead_form', data: { config: { fields: ['fullName', 'phone', 'email'], marketingConsent: true }, text: { tr: { title: 'Iletisim', submitLabel: 'Gonder' }, en: { title: 'Contact', submitLabel: 'Send' } } } },
  ],
};

/** Prisma client or interactive-transaction client. */
export type PlatformDefaultsDb = Prisma.TransactionClient | PrismaClient;

/** Creates a published page with its locales, blocks and version 1 snapshot. */
export async function createPublishedPage(db: PlatformDefaultsDb, siteId: string, page: PageDefault, publishedAt = new Date()): Promise<string> {
  const created = await db.page.create({
    data: { siteId, kind: page.kind, sectorKey: page.sectorKey ?? null, internalLabel: page.internalLabel, status: 'PUBLISHED', publishedAt },
  });

  const localeRows = [];
  for (const l of page.locales) {
    localeRows.push(
      await db.pageLocale.create({
        data: {
          pageId: created.id,
          siteId,
          locale: l.locale,
          slug: l.slug,
          seoTitle: l.seoTitle,
          seoDescription: l.seoDescription ?? null,
          legalApproved: l.legalApproved ?? false,
          legalApprovedAt: l.legalApproved ? publishedAt : null,
        },
      }),
    );
  }

  const blockRows = [];
  for (const [i, b] of page.blocks.entries()) {
    blockRows.push(await db.block.create({ data: { pageId: created.id, type: b.type, position: i, data: b.data as Prisma.InputJsonValue } }));
  }

  await db.pageVersion.create({
    data: {
      pageId: created.id,
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
  return created.id;
}

