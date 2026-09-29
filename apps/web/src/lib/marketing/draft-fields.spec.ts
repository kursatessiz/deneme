import { GENERATABLE_DRAFT_KINDS, parseMarketingContent } from '@platform/shared';
import { DRAFT_FIELD_SPECS, contentToValues, fieldLimit, valuesToContent } from './draft-fields';

describe('draft field editing', () => {
  it('has a field spec for every generatable kind', () => {
    for (const kind of GENERATABLE_DRAFT_KINDS) expect(DRAFT_FIELD_SPECS[kind].length).toBeGreaterThan(0);
  });

  it('round-trips list, heading and FAQ fields', () => {
    const seo = {
      title: 'Baslik',
      metaDescription: 'Aciklama',
      headings: [
        { level: 2, text: 'Ne yapar' },
        { level: 3, text: 'Rezervasyon' },
      ],
      faq: [{ question: 'Deneme var mi?', answer: 'Evet.' }],
      internalLinkIdeas: ['fiyatlar', 'ozellikler'],
    };
    const values = contentToValues('SEO_OUTLINE', seo);
    expect(values.headings).toBe('## Ne yapar\n### Rezervasyon');
    expect(values.faq).toBe('Deneme var mi? :: Evet.');
    expect(valuesToContent('SEO_OUTLINE', values)).toEqual(seo);
    expect(parseMarketingContent('SEO_OUTLINE', valuesToContent('SEO_OUTLINE', values)).ok).toBe(true);
  });

  it('drops blank lines and trims values so the API schema accepts the result', () => {
    const content = valuesToContent('AD_GOOGLE_RSA', { headlines: ' Bir \n\n Iki \nUc', descriptions: 'A\nB' });
    expect(content).toEqual({ headlines: ['Bir', 'Iki', 'Uc'], descriptions: ['A', 'B'] });
    expect(parseMarketingContent('AD_GOOGLE_RSA', content).ok).toBe(true);
  });

  it('exposes the platform limits per field (per line for lists)', () => {
    expect(fieldLimit('SMS', 'text')).toBe(480);
    expect(fieldLimit('AD_GOOGLE_RSA', 'headlines')).toBe(30);
    expect(fieldLimit('WHATSAPP', 'templateName')).toBeUndefined();
  });
});
