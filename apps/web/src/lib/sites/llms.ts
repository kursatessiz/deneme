import { PRODUCT_NAME, buildLlmsTxt, type LlmsLink, type LlmsSection, type PublicSiteSettingsDTO, type Translate } from '@platform/shared';
import { apiInternalBaseUrl } from '@/lib/server-env';
import { getTFor } from '@/lib/i18n/getT';
import { fetchBookingStudio, fetchPublicPage, fetchSitemapEntries, type HostSite } from '@/lib/sites/api';
import { siteOrigin, sitePath } from '@/lib/sites/origin';
import { negotiateRootLocale } from '@/lib/sites/root-locale';

/**
 * `/llms.txt` of the host's site (docs/SEO.md "llms.txt"): the platform site on its own domain, a tenant's own
 * site on its subdomain or custom domain. Built only from data the site already publishes (page titles and
 * descriptions, the blog index, and for a tenant its public services and booking page), in the visitor's
 * language limited to the languages the site is published in.
 */

const MAX_PAGES = 20;
const MAX_SERVICES = 30;
const REVALIDATE_SECONDS = 300;

interface PublicServiceType {
  name: string;
  description: string | null;
  durationMin: number;
}

async function fetchPublicServices(studioSlug: string): Promise<PublicServiceType[]> {
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/public/studios/${encodeURIComponent(studioSlug)}/embed/service-types`, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return [];
    return (await res.json()) as PublicServiceType[];
  } catch {
    return [];
  }
}

export async function buildSiteLlmsTxt(input: {
  site: HostSite;
  settings: PublicSiteSettingsDTO;
  cookieLocale: string | null | undefined;
  acceptLanguage: string | null | undefined;
}): Promise<string | null> {
  const { site } = input;
  const { items, defaultLocale, articles } = await fetchSitemapEntries(site.studioSlug);
  if (!defaultLocale) return null; // unknown site or API unreachable: nothing to describe

  const published = Array.from(new Set(items.map((item) => item.locale)));
  const locale = negotiateRootLocale({ cookie: input.cookieLocale, acceptLanguage: input.acceptLanguage, published, defaultLocale });
  const t: Translate = await getTFor(locale);
  const origin = site.origin;

  // Main pages: the home page first, then the rest by path, at most MAX_PAGES.
  const variants = items.filter((item) => item.locale === locale).sort((a, b) => (a.slug === '' ? -1 : b.slug === '' ? 1 : a.slug.localeCompare(b.slug))).slice(0, MAX_PAGES);
  const pageLinks: LlmsLink[] = [];
  let homeDescription: string | null = null;
  let homeTitle: string | null = null;
  for (const variant of variants) {
    const page = await fetchPublicPage(site.studioSlug, locale, variant.slug);
    if (!page) continue;
    const title = page.localeMeta.seoTitle ?? (variant.slug || locale);
    if (variant.slug === '') {
      homeDescription = page.localeMeta.seoDescription;
      homeTitle = title;
    }
    pageLinks.push({ title, url: `${origin}${sitePath(locale, variant.slug)}`, description: page.localeMeta.seoDescription });
  }

  const sections: LlmsSection[] = [{ title: t('seo.llms.pages'), links: pageLinks }];
  if ((articles ?? []).some((a) => a.locale === locale)) {
    sections.push({ title: t('seo.llms.blog'), links: [{ title: t('articles.public.title'), url: `${origin}/${locale}/blog` }] });
  }

  let name: string;
  let summary: string | null;
  if (site.isPlatform) {
    name = PRODUCT_NAME;
    summary = t('seo.root.description');
  } else {
    const studio = await fetchBookingStudio(site.studioSlug);
    name = studio?.name ?? homeTitle ?? site.studioSlug;
    summary = homeDescription ?? t('seo.llms.tenantSummary', { name });

    const services = (await fetchPublicServices(site.studioSlug)).slice(0, MAX_SERVICES);
    const duration = new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'short' });
    if (services.length > 0) {
      sections.push({
        title: t('seo.llms.services'),
        links: services.map((s) => ({ title: s.name, url: `${origin}/${locale}`, description: s.description ?? duration.format(s.durationMin) })),
      });
    }
    sections.push({
      title: t('seo.llms.booking'),
      links: [{ title: t('seo.llms.bookingLink'), url: `${siteOrigin('platform', true)}/booking/${site.studioSlug}/book` }],
    });
  }

  return buildLlmsTxt({ name, summary, sections });
}
