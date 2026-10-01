import { BLOCK_TYPES, LEAD_FORM_FIELDS, deriveAllBlockFormSpecs, deriveBlockFormSpec, type BlockFormField } from './index';

const byKey = (fields: readonly BlockFormField[], key: string): BlockFormField => {
  const field = fields.find((f) => f.key === key);
  if (!field) throw new Error(`field ${key} missing`);
  return field;
};

describe('sites/block form derivation', () => {
  it('derives a spec for every block type', () => {
    const specs = deriveAllBlockFormSpecs();
    expect(specs.map((s) => s.type)).toEqual([...BLOCK_TYPES]);
    for (const spec of specs) expect(spec.text.length + spec.config.length).toBeGreaterThan(0);
  });

  it('covers every field of every block schema (nothing falls back to the JSON view)', () => {
    for (const spec of deriveAllBlockFormSpecs()) {
      const all = [...spec.config, ...spec.text, ...spec.text.flatMap((f) => f.itemFields ?? [])];
      expect(all.filter((f) => f.kind === 'unsupported').map((f) => `${spec.type}.${f.key}`)).toEqual([]);
    }
  });

  it('derives the hero fields: required title, optional texts, link targets and an image url', () => {
    const hero = deriveBlockFormSpec('hero');
    expect(hero.text.map((f) => f.key)).toEqual(['eyebrow', 'title', 'subtitle', 'primaryCtaLabel', 'primaryCtaHref', 'secondaryCtaLabel', 'secondaryCtaHref']);
    expect(byKey(hero.text, 'title')).toMatchObject({ kind: 'text', required: true, maxLength: 200 });
    expect(byKey(hero.text, 'subtitle')).toMatchObject({ kind: 'textarea', required: false, maxLength: 4000 });
    expect(byKey(hero.text, 'primaryCtaHref')).toMatchObject({ kind: 'href', required: false });
    expect(byKey(hero.config, 'imageUrl')).toMatchObject({ kind: 'url', required: false });
  });

  it('derives repeatable items with their own fields and limits', () => {
    const faq = byKey(deriveBlockFormSpec('faq').text, 'items');
    expect(faq).toMatchObject({ kind: 'repeatable', maxItems: 30, required: true });
    expect(faq.itemFields?.map((f) => [f.key, f.kind])).toEqual([['question', 'text'], ['answer', 'textarea']]);

    expect(byKey(deriveBlockFormSpec('feature_grid').text, 'items')).toMatchObject({ kind: 'repeatable', maxItems: 12 });
    expect(byKey(deriveBlockFormSpec('how_it_works').text, 'steps')).toMatchObject({ kind: 'repeatable', maxItems: 8 });
    const trainer = byKey(deriveBlockFormSpec('trainers').text, 'items');
    expect(trainer.itemFields?.map((f) => [f.key, f.kind, f.required])).toEqual([['name', 'text', true], ['photoUrl', 'url', false], ['bio', 'textarea', false]]);
    const testimonial = byKey(deriveBlockFormSpec('testimonials').text, 'items');
    expect(testimonial.itemFields?.map((f) => f.key)).toEqual(['quote', 'authorName', 'authorRole']);
  });

  it('derives list, choice and boolean config', () => {
    expect(byKey(deriveBlockFormSpec('sector_cards').config, 'sectorKeys')).toMatchObject({ kind: 'string_list', maxItems: 24 });
    const lead = deriveBlockFormSpec('lead_form');
    expect(byKey(lead.config, 'fields')).toMatchObject({ kind: 'choice_list', choices: [...LEAD_FORM_FIELDS], minItems: 2 });
    expect(byKey(lead.config, 'marketingConsent')).toMatchObject({ kind: 'boolean', required: false });
    expect(byKey(lead.config, 'studioSlug')).toMatchObject({ kind: 'text' });
    expect(deriveBlockFormSpec('contact').config.map((f) => [f.key, f.kind])).toEqual([['showAddress', 'boolean'], ['showPhone', 'boolean'], ['showEmail', 'boolean']]);
    // Schema defaults are carried so a missing value shows as the stored default.
    expect(deriveBlockFormSpec('contact').config.map((f) => f.defaultValue)).toEqual([true, true, true]);
    expect(byKey(deriveBlockFormSpec('pricing').config, 'hidden').defaultValue).toBe(false);
    expect(byKey(lead.config, 'fields').defaultValue).toEqual(['fullName', 'phone']);
    expect(byKey(lead.config, 'marketingConsent').defaultValue).toBeUndefined();
    expect(byKey(deriveBlockFormSpec('pricing').config, 'hidden')).toMatchObject({ kind: 'boolean' });
  });

  it('puts the legal body in a textarea and the cta link target in an href field', () => {
    expect(byKey(deriveBlockFormSpec('legal_text').text, 'body')).toMatchObject({ kind: 'textarea', required: true, maxLength: 60000 });
    const cta = deriveBlockFormSpec('cta').text;
    expect(byKey(cta, 'buttonHref')).toMatchObject({ kind: 'href', required: true });
    expect(byKey(cta, 'buttonLabel')).toMatchObject({ kind: 'text', required: true });
  });
});
