import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { DEFAULT_TENANT_THEME } from '@platform/shared';
import { fetchPublicPage } from '@/lib/sites/api';
import { pickPageVariant } from '@/lib/sites/ab';
import { getTFor } from '@/lib/i18n/getT';
import { ThemeRoot } from '@/components/theme/ThemeRoot';
import { PublicTracking } from '@/components/consent/PublicTracking';
import { BlockRenderer } from './BlockRenderer';
import { organizationJsonLd, localBusinessJsonLd, faqPageJsonLd, offerJsonLd } from '@/lib/sites/jsonld';

export function sitesBaseDomain(): string {
  return process.env.SITES_DOMAIN || process.env.WEB_DOMAIN || 'localhost';
}

export function siteOrigin(studioSlug: string, isPlatform: boolean): string {
  const base = sitesBaseDomain();
  const host = isPlatform ? base : `${studioSlug}.${base}`;
  const protocol = base === 'localhost' ? 'http' : 'https';
  return `${protocol}://${host}`;
}

export function sitePath(locale: string, slug: string): string {
  return slug ? `/${locale}/${slug}` : `/${locale}`;
}
const pathFor = sitePath;

/** Shared by the platform's `/[locale]/[[...slug]]` route and a tenant site's `tenant-site/[studioSlug]/[locale]/[[...slug]]` route. */
export async function buildSiteMetadata(studioSlug: string, isPlatform: boolean, locale: string, slugParts: string[] | undefined): Promise<Metadata> {
  const slug = (slugParts ?? []).join('/');
  const page = await fetchPublicPage(studioSlug, locale, slug);
  if (!page) return {};
  const origin = siteOrigin(studioSlug, isPlatform);
  const languages: Record<string, string> = {};
  for (const l of page.allLocales) languages[l.locale] = `${origin}${pathFor(l.locale, l.slug)}`;

  return {
    title: page.localeMeta.seoTitle ?? undefined,
    description: page.localeMeta.seoDescription ?? undefined,
    alternates: {
      canonical: `${origin}${pathFor(locale, slug)}`,
      languages,
    },
    openGraph: {
      title: page.localeMeta.seoTitle ?? undefined,
      description: page.localeMeta.seoDescription ?? undefined,
      images: page.localeMeta.ogImageUrl ? [page.localeMeta.ogImageUrl] : undefined,
      url: `${origin}${pathFor(locale, slug)}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: page.localeMeta.seoTitle ?? undefined,
      description: page.localeMeta.seoDescription ?? undefined,
    },
  };
}

export async function SitePageView({ studioSlug, isPlatform, locale, slugParts }: { studioSlug: string; isPlatform: boolean; locale: string; slugParts: string[] | undefined }) {
  const slug = (slugParts ?? []).join('/');
  const page = await fetchPublicPage(studioSlug, locale, slug);
  if (!page) notFound();

  const variantKeys = Array.from(new Set(page.blocks.map((b) => b.abVariantKey).filter((v): v is string => !!v))).sort();
  const { variant } = await pickPageVariant(variantKeys);
  const t = await getTFor(locale);

  const origin = siteOrigin(studioSlug, isPlatform);
  const pageUrl = `${origin}${pathFor(locale, slug)}`;

  const faqBlock = page.blocks.find((b) => b.type === 'faq');
  const faqItems = faqBlock ? ((faqBlock.data as { text?: Record<string, { items?: { question: string; answer: string }[] }> }).text?.[locale]?.items ?? []) : [];

  const orgJsonLd = page.context.companyInfo
    ? organizationJsonLd({ name: page.context.companyInfo.legalName, url: origin, email: page.context.companyInfo.email, phone: page.context.companyInfo.phone })
    : page.context.studioContact
      ? localBusinessJsonLd({ name: page.context.studioContact.name, url: origin, address: page.context.studioContact.address, phone: page.context.studioContact.phone, email: page.context.studioContact.email })
      : null;

  const offerItems = (page.context.plans ?? []).map((p) => ({ name: p.name, price: p.priceMonthly, currency: 'USD', url: pageUrl }));

  return (
    <ThemeRoot tenantTheme={page.theme ?? DEFAULT_TENANT_THEME} appearance={{ themeFamily: null, colorScheme: 'SYSTEM' }}>
      <PublicTracking studioSlug={studioSlug} />
      {orgJsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }} />}
      {faqItems.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageJsonLd(faqItems)) }} />}
      {offerItems.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(offerJsonLd(offerItems)) }} />}

      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {page.page.kind === 'LEGAL' && !page.localeMeta.legalApproved && (
          <div
            role="note"
            style={{
              backgroundColor: 'var(--color-warning-surface, #fef3c7)',
              color: 'var(--color-warning-text, #92400e)',
              textAlign: 'center',
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {t('sites.legalDraftBanner')}
          </div>
        )}
        <main style={{ flex: 1 }}>
          <BlockRenderer blocks={page.blocks} locale={locale} defaultLocale={page.defaultLocale} studioSlug={studioSlug} context={page.context} variant={variant} t={t} />
        </main>
      </div>
    </ThemeRoot>
  );
}
