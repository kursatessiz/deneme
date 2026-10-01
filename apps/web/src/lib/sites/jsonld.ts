/**
 * Structured data builders (Organization / LocalBusiness / WebSite / BreadcrumbList / FAQPage /
 * SoftwareApplication / Product with Offer) for the page engine's public pages
 * (docs/SAYFA_MOTORU.md, section 5; catalogue in docs/SEO.md). Pure functions returning plain
 * objects; the page embeds them as `<script type="application/ld+json">`.
 */

const CONTEXT = 'https://schema.org';

/** Only absolute https links are emitted as `sameAs` (the values are tenant input). */
export function sameAsLinks(socialLinks: Record<string, string> | null | undefined): string[] {
  const out: string[] = [];
  for (const value of Object.values(socialLinks ?? {})) {
    try {
      if (new URL(value).protocol === 'https:' && !out.includes(value)) out.push(value);
    } catch {
      // not a URL: dropped
    }
  }
  return out;
}

export function organizationJsonLd(params: {
  name: string;
  url: string;
  logoUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  sameAs?: readonly string[];
}) {
  return {
    '@context': CONTEXT,
    '@type': 'Organization',
    name: params.name,
    url: params.url,
    ...(params.logoUrl ? { logo: params.logoUrl } : {}),
    ...(params.email ? { email: params.email } : {}),
    ...(params.phone ? { telephone: params.phone } : {}),
    ...(params.sameAs && params.sameAs.length > 0 ? { sameAs: [...params.sameAs] } : {}),
  };
}

/** The studio's address is a single free-text field today, so it stays a string (no PostalAddress). */
export function localBusinessJsonLd(params: {
  name: string;
  url: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  imageUrl?: string | null;
}) {
  return {
    '@context': CONTEXT,
    '@type': 'LocalBusiness',
    name: params.name,
    url: params.url,
    ...(params.imageUrl ? { image: params.imageUrl } : {}),
    ...(params.address ? { address: params.address } : {}),
    ...(params.phone ? { telephone: params.phone } : {}),
    ...(params.email ? { email: params.email } : {}),
  };
}

export function webSiteJsonLd(params: { name: string; url: string; locale: string }) {
  return { '@context': CONTEXT, '@type': 'WebSite', name: params.name, url: params.url, inLanguage: params.locale };
}

export function breadcrumbJsonLd(items: readonly { name: string; url: string }[]) {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: item.url })),
  };
}

/** One FAQPage for the whole page: the questions of every faq block, in page order. */
export function faqPageJsonLd(items: readonly { question: string; answer: string }[]) {
  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.question,
      acceptedAnswer: { '@type': 'Answer', text: i.answer },
    })),
  };
}

interface PricedItem {
  name: string;
  price: string;
  currency: string;
  url: string;
}

function offerOf(item: PricedItem) {
  return { '@type': 'Offer', price: item.price, priceCurrency: item.currency, url: item.url };
}

/** Platform plans and tenant packages: each item is a Product carrying its Offer (priceCurrency from the item's own currency). */
export function productJsonLd(items: readonly PricedItem[]) {
  return items.map((i) => ({ '@context': CONTEXT, '@type': 'Product', name: i.name, offers: offerOf(i) }));
}

/** The platform's own product on its home page; offers come from the published plans when a pricing block loaded them. */
export function softwareApplicationJsonLd(params: { name: string; url: string; offers?: readonly PricedItem[] }) {
  return {
    '@context': CONTEXT,
    '@type': 'SoftwareApplication',
    name: params.name,
    url: params.url,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    ...(params.offers && params.offers.length > 0 ? { offers: params.offers.map(offerOf) } : {}),
  };
}

export interface EventJsonLdInput {
  name: string;
  url: string;
  description?: string | null;
  imageUrl?: string | null;
  /** ISO 8601 with the zone offset (zoned-time.zonedIsoString). */
  startDate: string;
  endDate?: string | null;
  location: { name: string; address?: string | null };
  organizer: { name: string; url: string };
  offers: readonly { name: string; price: string; currency: string; url: string; available: boolean }[];
  /** The dated sessions of a multi-session event (course, series), each with its own offset. */
  occurrences?: readonly { startDate: string; endDate: string }[];
}

/**
 * schema.org Event for a published public event (docs/SEO.md). Only PUBLISHED events reach the public pages,
 * so the status is always EventScheduled; the events module has no online mode, hence an offline attendance
 * mode. The address stays a free-text string, as the studio and branch address fields are.
 */
export function eventJsonLd(input: EventJsonLdInput) {
  return {
    '@context': CONTEXT,
    '@type': 'Event',
    name: input.name,
    url: input.url,
    startDate: input.startDate,
    ...(input.endDate ? { endDate: input.endDate } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(input.description ? { description: input.description } : {}),
    ...(input.imageUrl ? { image: [input.imageUrl] } : {}),
    location: {
      '@type': 'Place',
      name: input.location.name,
      ...(input.location.address ? { address: input.location.address } : {}),
    },
    organizer: { '@type': 'Organization', name: input.organizer.name, url: input.organizer.url },
    ...(input.offers.length > 0
      ? {
          offers: input.offers.map((offer) => ({
            '@type': 'Offer',
            name: offer.name,
            price: offer.price,
            priceCurrency: offer.currency,
            url: offer.url,
            availability: offer.available ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
          })),
        }
      : {}),
    ...(input.occurrences && input.occurrences.length > 1
      ? { subEvent: input.occurrences.map((o) => ({ '@type': 'Event', name: input.name, startDate: o.startDate, endDate: o.endDate })) }
      : {}),
  };
}
