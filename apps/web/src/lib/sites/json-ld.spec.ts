import { serializeJsonLd } from './json-ld';
import {
  articleJsonLd,
  breadcrumbJsonLd,
  eventJsonLd,
  faqPageJsonLd,
  localBusinessJsonLd,
  organizationJsonLd,
  productJsonLd,
  sameAsLinks,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from './jsonld';

describe('serializeJsonLd', () => {
  it('never lets a value close the script tag', () => {
    const out = serializeJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });

  it('round-trips to the same data', () => {
    const data = { a: 'x < y & z > w', b: 'line\u2028sep', c: [1, 2] };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});

describe('organization and local business', () => {
  it('adds logo and sameAs to the organization', () => {
    const org = organizationJsonLd({ name: 'Acme', url: 'https://acme.test', logoUrl: 'https://cdn.test/l.png', sameAs: ['https://instagram.com/acme'] });
    expect(org).toMatchObject({ '@type': 'Organization', logo: 'https://cdn.test/l.png', sameAs: ['https://instagram.com/acme'] });
  });

  it('omits empty optional fields', () => {
    const org = organizationJsonLd({ name: 'Acme', url: 'https://acme.test', sameAs: [] });
    expect(org).not.toHaveProperty('logo');
    expect(org).not.toHaveProperty('sameAs');
  });

  it('keeps only absolute https social links, without duplicates', () => {
    expect(sameAsLinks({ a: 'https://x.com/a', b: 'http://insecure.test', c: 'not a url', d: 'https://x.com/a' })).toEqual(['https://x.com/a']);
    expect(sameAsLinks(undefined)).toEqual([]);
  });

  it('gives a local business telephone, url and image, with the address left as a string', () => {
    const lb = localBusinessJsonLd({ name: 'Studio', url: 'https://s.test', address: 'Main St 1', phone: '+90 555', imageUrl: 'https://cdn.test/l.png' });
    expect(lb).toMatchObject({ '@type': 'LocalBusiness', url: 'https://s.test', image: 'https://cdn.test/l.png', address: 'Main St 1', telephone: '+90 555' });
  });
});

describe('website and breadcrumbs', () => {
  it('declares the website language', () => {
    expect(webSiteJsonLd({ name: 'Acme', url: 'https://acme.test', locale: 'tr' })).toMatchObject({ '@type': 'WebSite', inLanguage: 'tr' });
  });

  it('numbers breadcrumb items from 1 with absolute urls', () => {
    const crumbs = breadcrumbJsonLd([
      { name: 'Home', url: 'https://x.test/tr' },
      { name: 'Pilates', url: 'https://x.test/tr/pilates' },
      { name: 'Trial', url: 'https://x.test/tr/pilates/trial' },
    ]);
    expect(crumbs.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(crumbs.itemListElement[2]).toMatchObject({ name: 'Trial', item: 'https://x.test/tr/pilates/trial' });
  });
});

describe('faq, products and software application', () => {
  it('builds one FAQPage from every question it is given', () => {
    const faq = faqPageJsonLd([
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
    ]);
    expect(faq.mainEntity).toHaveLength(2);
    expect(faq.mainEntity[1]).toMatchObject({ name: 'Q2', acceptedAnswer: { text: 'A2' } });
  });

  it('wraps each priced item in a Product with an Offer in its own currency', () => {
    const [plan, pkg] = productJsonLd([
      { name: 'Pro', price: '29.00', currency: 'USD', url: 'https://x.test/en' },
      { name: '10 sessions', price: '1500.00', currency: 'TRY', url: 'https://x.test/tr' },
    ]);
    expect(plan).toMatchObject({ '@type': 'Product', name: 'Pro', offers: { '@type': 'Offer', price: '29.00', priceCurrency: 'USD' } });
    expect(pkg.offers.priceCurrency).toBe('TRY');
  });

  it('describes the platform as a business application with plan offers', () => {
    const app = softwareApplicationJsonLd({ name: 'Platform', url: 'https://p.test', offers: [{ name: 'Pro', price: '29.00', currency: 'USD', url: 'https://p.test/en' }] });
    expect(app).toMatchObject({ '@type': 'SoftwareApplication', applicationCategory: 'BusinessApplication' });
    expect(app).toHaveProperty('offers');
    expect(softwareApplicationJsonLd({ name: 'Platform', url: 'https://p.test' })).not.toHaveProperty('offers');
  });
});

describe('eventJsonLd', () => {
  const base = {
    name: 'Workshop',
    url: 'https://zen.example.test/events/workshop-1',
    startDate: '2026-10-10T10:00:00+03:00',
    endDate: '2026-10-10T13:00:00+03:00',
    location: { name: 'Zen Studio', address: 'Main Street 1, Istanbul' },
    organizer: { name: 'Zen Studio', url: 'https://zen.example.test' },
    offers: [{ name: 'Standard', price: '750.00', currency: 'TRY', url: 'https://zen.example.test/events/workshop-1', available: true }],
  };

  it('emits the Event shape with offset dates, place, organizer and offers', () => {
    const doc = eventJsonLd({ ...base, description: 'A workshop.', imageUrl: 'https://cdn.test/w.png' });
    expect(doc).toMatchObject({
      '@type': 'Event',
      name: 'Workshop',
      startDate: '2026-10-10T10:00:00+03:00',
      endDate: '2026-10-10T13:00:00+03:00',
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      image: ['https://cdn.test/w.png'],
      location: { '@type': 'Place', name: 'Zen Studio', address: 'Main Street 1, Istanbul' },
      organizer: { '@type': 'Organization', name: 'Zen Studio' },
      offers: [{ '@type': 'Offer', price: '750.00', priceCurrency: 'TRY', availability: 'https://schema.org/InStock' }],
    });
  });

  it('marks a sold out ticket and omits empty optional fields', () => {
    const doc = eventJsonLd({ ...base, endDate: null, location: { name: 'Zen Studio' }, offers: [{ ...base.offers[0], available: false }] });
    expect(doc).not.toHaveProperty('endDate');
    expect(doc).not.toHaveProperty('image');
    expect(doc).not.toHaveProperty('description');
    expect(doc.location).not.toHaveProperty('address');
    expect(doc.offers?.[0].availability).toBe('https://schema.org/SoldOut');
  });

  it('lists the sessions of a multi-session event as subEvent', () => {
    const doc = eventJsonLd({
      ...base,
      occurrences: [
        { startDate: '2026-10-10T10:00:00+03:00', endDate: '2026-10-10T11:00:00+03:00' },
        { startDate: '2026-10-17T10:00:00+03:00', endDate: '2026-10-17T11:00:00+03:00' },
      ],
    });
    expect(doc.subEvent).toHaveLength(2);
    expect(eventJsonLd({ ...base, occurrences: [{ startDate: base.startDate, endDate: base.endDate }] })).not.toHaveProperty('subEvent');
  });

  it('is safe to serialize into a script tag', () => {
    const out = serializeJsonLd(eventJsonLd({ ...base, name: '</script>' }));
    expect(out).not.toContain('<');
  });
});

describe('articleJsonLd', () => {
  const base = {
    headline: 'Hello',
    url: 'https://acme.test/en/blog/hello',
    datePublished: '2026-09-15T08:00:00.000Z',
    dateModified: '2026-09-16T08:00:00.000Z',
    locale: 'en',
    author: { name: 'Ayse', kind: 'Person' as const },
    publisher: { name: 'Acme', url: 'https://acme.test', logoUrl: 'https://cdn.test/l.png' },
  };

  it('carries dates, language, author, publisher with logo and the main entity', () => {
    expect(articleJsonLd({ ...base, imageUrl: 'https://cdn.test/c.png', description: 'Short' })).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'Hello',
      url: 'https://acme.test/en/blog/hello',
      mainEntityOfPage: { '@type': 'WebPage', '@id': 'https://acme.test/en/blog/hello' },
      inLanguage: 'en',
      datePublished: '2026-09-15T08:00:00.000Z',
      dateModified: '2026-09-16T08:00:00.000Z',
      description: 'Short',
      image: ['https://cdn.test/c.png'],
      author: { '@type': 'Person', name: 'Ayse' },
      publisher: { '@type': 'Organization', name: 'Acme', url: 'https://acme.test', logo: { '@type': 'ImageObject', url: 'https://cdn.test/l.png' } },
    });
  });

  it('omits empty optional fields and caps the headline', () => {
    const doc = articleJsonLd({ ...base, headline: 'x'.repeat(200), publisher: { name: 'Acme', url: 'https://acme.test' }, author: { name: 'Acme', kind: 'Organization' } });
    expect(doc.headline).toHaveLength(110);
    expect(doc).not.toHaveProperty('image');
    expect(doc).not.toHaveProperty('description');
    expect(doc.publisher).not.toHaveProperty('logo');
    expect(doc.author).toEqual({ '@type': 'Organization', name: 'Acme' });
  });
});
