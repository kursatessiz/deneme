/**
 * Structured data builders (Organization / LocalBusiness / FAQPage / Offer)
 * for the page engine's public pages (docs/SAYFA_MOTORU.md, section 5).
 * Pure functions returning plain objects; the page embeds them as
 * `<script type="application/ld+json">`.
 */

export function organizationJsonLd(params: { name: string; url: string; logoUrl?: string | null; email?: string | null; phone?: string | null }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: params.name,
    url: params.url,
    ...(params.logoUrl ? { logo: params.logoUrl } : {}),
    ...(params.email ? { email: params.email } : {}),
    ...(params.phone ? { telephone: params.phone } : {}),
  };
}

export function localBusinessJsonLd(params: { name: string; url: string; address?: string | null; phone?: string | null; email?: string | null }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: params.name,
    url: params.url,
    ...(params.address ? { address: params.address } : {}),
    ...(params.phone ? { telephone: params.phone } : {}),
    ...(params.email ? { email: params.email } : {}),
  };
}

export function faqPageJsonLd(items: readonly { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.question,
      acceptedAnswer: { '@type': 'Answer', text: i.answer },
    })),
  };
}

export function offerJsonLd(items: readonly { name: string; price: string; currency: string; url: string }[]) {
  return items.map((i) => ({
    '@context': 'https://schema.org',
    '@type': 'Offer',
    name: i.name,
    price: i.price,
    priceCurrency: i.currency,
    url: i.url,
  }));
}
