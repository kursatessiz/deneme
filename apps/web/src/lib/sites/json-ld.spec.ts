import { serializeJsonLd } from './json-ld';
import {
  breadcrumbJsonLd,
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
