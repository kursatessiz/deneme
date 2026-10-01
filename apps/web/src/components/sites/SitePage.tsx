import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PRODUCT_NAME, buildHreflangAlternates } from '@platform/shared';
import { toOgLocale } from '@/lib/seo/og-locale';
import { verificationMetadata } from '@/lib/seo/verification';
import { fetchPublicPage, fetchSiteSettings } from '@/lib/sites/api';
import { sitePath } from '@/lib/sites/origin';
import { pickPageVariant } from '@/lib/sites/ab';
import { getTFor } from '@/lib/i18n/getT';
import { serializeJsonLd } from '@/lib/sites/json-ld';
import { BlockRenderer } from './BlockRenderer';
import { SiteShell, poweredByOf } from './SiteShell';
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  localBusinessJsonLd,
  organizationJsonLd,
  productJsonLd,
  sameAsLinks,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from '@/lib/sites/jsonld';

const pathFor = sitePath;

/** Shared by the platform's `/[locale]/[[...slug]]` route and a tenant site's `tenant-site/[studioSlug]/[locale]/[[...slug]]` route. */
export async function buildSiteMetadata(studioSlug: string, isPlatform: boolean, locale: string, slugParts: string[] | undefined): Promise<Metadata> {
  const slug = (slugParts ?? []).join('/');
  const page = await fetchPublicPage(studioSlug, locale, slug);
  if (!page) return {};
  const settings = await fetchSiteSettings(studioSlug);
  const origin = settings.canonicalOrigin;
  // The platform home page's x-default is the origin root, which redirects to the visitor's locale (app/route.ts).
  const xDefaultUrl = isPlatform && page.page.kind === 'HOME' && slug === '' ? `${origin}/` : null;
  const languages = buildHreflangAlternates(page.allLocales, (l, sl) => `${origin}${pathFor(l, sl)}`, page.defaultLocale, xDefaultUrl);

  const title = page.localeMeta.seoTitle ?? undefined;
  const description = page.localeMeta.seoDescription ?? undefined;
  const url = `${origin}${pathFor(locale, slug)}`;
  // The page's own image when set, otherwise the generated card (app/og/route.tsx).
  const ogImage = page.localeMeta.ogImageUrl
    ? { url: page.localeMeta.ogImageUrl }
    : { url: `${origin}/og?${new URLSearchParams({ locale, ...(slug ? { slug } : {}) }).toString()}`, width: 1200, height: 630, alt: title };
  const siteName = isPlatform ? PRODUCT_NAME : (page.context.studioContact?.name ?? page.context.companyInfo?.legalName ?? undefined);

  const verification = verificationMetadata(settings);
  return {
    title,
    description,
    ...(verification ? { verification } : {}),
    alternates: {
      canonical: url,
      languages,
    },
    openGraph: {
      type: 'website',
      siteName,
      locale: toOgLocale(locale),
      alternateLocale: page.allLocales.filter((l) => l.locale !== locale).map((l) => toOgLocale(l.locale)),
      title,
      description,
      images: [ogImage],
      url,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage.url],
    },
  };
}

/** `pilates` -> `Pilates`, `free-trial` -> `Free trial`: the fallback label of a path segment whose page title is unknown. */
function humanizeSegment(segment: string): string {
  const text = segment.replace(/-/g, ' ');
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/**
 * Home > sector > offer / slug trail for the BreadcrumbList. A parent segment's label is that page's own
 * title when it is published (the same cached read the renderer uses), else the humanized segment.
 */
async function buildBreadcrumbs(params: { studioSlug: string; origin: string; locale: string; slug: string; siteName: string; pageTitle: string | null }): Promise<{ name: string; url: string }[]> {
  const trail = [{ name: params.siteName, url: `${params.origin}${pathFor(params.locale, '')}` }];
  if (!params.slug) return trail;
  const segments = params.slug.split('/');
  for (let i = 1; i <= segments.length; i += 1) {
    const path = segments.slice(0, i).join('/');
    const isLast = i === segments.length;
    let name = isLast ? params.pageTitle : null;
    if (!name && !isLast) name = (await fetchPublicPage(params.studioSlug, params.locale, path))?.localeMeta.seoTitle ?? null;
    trail.push({ name: name ?? humanizeSegment(segments[i - 1]), url: `${params.origin}${pathFor(params.locale, path)}` });
  }
  return trail;
}

/**
 * `perRequest` is set only by the `_dynamic` routes the middleware sends A/B pages to: they read the visitor's
 * cookies to pick a variant, so they are never cached. Every other render is a cached ISR render.
 */
export async function SitePageView({ studioSlug, isPlatform, locale, slugParts, perRequest = false }: { studioSlug: string; isPlatform: boolean; locale: string; slugParts: string[] | undefined; perRequest?: boolean }) {
  const slug = (slugParts ?? []).join('/');
  const page = await fetchPublicPage(studioSlug, locale, slug);
  if (!page) notFound();

  const variantKeys = Array.from(new Set(page.blocks.map((b) => b.abVariantKey).filter((v): v is string => !!v))).sort();
  const { variant } = await pickPageVariant(variantKeys, perRequest);
  const [t, settings] = await Promise.all([getTFor(locale), fetchSiteSettings(studioSlug)]);

  const origin = settings.canonicalOrigin;
  const pageUrl = `${origin}${pathFor(locale, slug)}`;

  const faqItems = page.blocks
    .filter((b) => b.type === 'faq')
    .flatMap((b) => (b.data as { text?: Record<string, { items?: { question: string; answer: string }[] }> }).text?.[locale]?.items ?? []);

  const { companyInfo, studioContact } = page.context;
  const siteName = isPlatform ? PRODUCT_NAME : (studioContact?.name ?? companyInfo?.legalName ?? null);
  const logoUrl = page.theme?.logoUrl ?? null;
  const isHome = page.page.kind === 'HOME';

  const jsonLd: unknown[] = [];
  if (companyInfo) {
    jsonLd.push(organizationJsonLd({ name: companyInfo.legalName, url: origin, logoUrl, email: companyInfo.email, phone: companyInfo.phone, sameAs: sameAsLinks(companyInfo.socialLinks) }));
  } else if (studioContact) {
    jsonLd.push(localBusinessJsonLd({ name: studioContact.name, url: origin, imageUrl: logoUrl, address: studioContact.address, phone: studioContact.phone, email: studioContact.email }));
  }
  if (isHome && siteName) jsonLd.push(webSiteJsonLd({ name: siteName, url: origin, locale }));
  jsonLd.push(breadcrumbJsonLd(await buildBreadcrumbs({ studioSlug, origin, locale, slug, siteName: siteName ?? origin, pageTitle: page.localeMeta.seoTitle })));
  if (faqItems.length > 0) jsonLd.push(faqPageJsonLd(faqItems));

  const plans = (page.context.plans ?? []).map((p) => ({ name: p.name, price: p.priceMonthly, currency: p.currency, url: pageUrl }));
  const packages = (page.context.packages ?? []).map((p) => ({ name: p.name, price: p.price, currency: p.currency, url: pageUrl }));
  if (isPlatform && isHome) jsonLd.push(softwareApplicationJsonLd({ name: PRODUCT_NAME, url: origin, offers: plans }));
  jsonLd.push(...productJsonLd([...plans, ...packages]));

  return (
    <SiteShell
      theme={page.theme}
      studioSlug={studioSlug}
      cookieLabel={t('sites.footer.cookiePreferences')}
      jsonLd={jsonLd.map(serializeJsonLd)}
      poweredBy={poweredByOf(settings, t)}
      banner={
        page.page.kind === 'LEGAL' && !page.localeMeta.legalApproved ? (
          <div role="note" className="ui-panel ui-strong ui-text-warn text-center px-4 py-3">
            {t('sites.legalDraftBanner')}
          </div>
        ) : null
      }
    >
      <BlockRenderer blocks={page.blocks} locale={locale} defaultLocale={page.defaultLocale} studioSlug={studioSlug} context={page.context} variant={variant} t={t} />
    </SiteShell>
  );
}
