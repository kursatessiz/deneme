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

/** The platform site's home page, so `/` (and the deploy smoke test) render on a fresh environment. */
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

