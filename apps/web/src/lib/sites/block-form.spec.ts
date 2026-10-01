import { BLOCK_TYPES, BLOCK_SCHEMAS, BUNDLED_MESSAGES, LEAD_FORM_FIELDS, deriveAllBlockFormSpecs, createTranslator, type BlockFormField } from '@platform/shared';
import { blockErrors, choiceLabelKey, fieldLabelKey, getAt, newBlockData, removeAt, setAt, setConfigField, setLocaleField } from './block-form';

describe('block form data edits', () => {
  it('sets a nested value without mutating the original', () => {
    const data = { config: {}, text: { tr: { title: 'A' } } };
    const next = setAt(data, ['text', 'tr', 'title'], 'B') as typeof data;
    expect(next.text.tr.title).toBe('B');
    expect(data.text.tr.title).toBe('A');
    expect(setAt({}, ['text', 'en', 'items', 1, 'question'], 'Q')).toEqual({ text: { en: { items: [undefined, { question: 'Q' }] } } });
  });

  it('removes a key or an array element', () => {
    expect(removeAt({ a: 1, b: 2 }, ['a'])).toEqual({ b: 2 });
    expect(removeAt({ items: ['x', 'y', 'z'] }, ['items', 1])).toEqual({ items: ['x', 'z'] });
    expect(getAt({ a: [{ b: 3 }] }, ['a', 0, 'b'])).toBe(3);
    expect(getAt({}, ['a', 'b'])).toBeUndefined();
  });

  it('drops an emptied optional field and a locale with nothing left, but keeps a required field while others have content', () => {
    let data: unknown = { config: {}, text: { tr: { title: 'T', subtitle: 'S' } } };
    data = setLocaleField(data, 'tr', ['subtitle'], '', false);
    expect(data).toEqual({ config: {}, text: { tr: { title: 'T' } } });

    // A cleared required title stays as an empty string (the schema then flags it) while the locale has other content.
    const withSubtitle = setLocaleField({ config: {}, text: { tr: { title: 'T', subtitle: 'S' } } }, 'tr', ['title'], '', true);
    expect(getAt(withSubtitle, ['text', 'tr', 'title'])).toBe('');
    expect(blockErrors('hero', withSubtitle)['text.tr.title']?.key).toBe('sites.editor.blocks.error.required');

    // Nothing left in a language: it is removed and counts as untranslated.
    expect(setLocaleField(data, 'tr', ['title'], '', true)).toEqual({ config: {}, text: {} });
    expect(setLocaleField({ config: {}, text: { en: { subtitle: 'S' } } }, 'en', ['subtitle'], '', false)).toEqual({ config: {}, text: {} });
  });

  it('starts a new locale on first input and edits config', () => {
    const data = setLocaleField({ config: {}, text: { tr: { title: 'T' } } }, 'en', ['title'], 'Title', true);
    expect(getAt(data, ['text', 'en', 'title'])).toBe('Title');
    expect(setConfigField({ config: { imageUrl: 'https://x.test/a.png' }, text: {} }, ['imageUrl'], '', false)).toEqual({ config: {}, text: {} });
  });
});

describe('block form validation messages', () => {
  const keys = (type: Parameters<typeof blockErrors>[0], data: unknown) => Object.fromEntries(Object.entries(blockErrors(type, data)).map(([path, e]) => [path, e.key]));

  it('reports nothing for valid data', () => {
    expect(blockErrors('hero', { config: {}, text: { tr: { title: 'T' } } })).toEqual({});
  });

  it('maps a missing or empty required text to required', () => {
    expect(keys('hero', { config: {}, text: { tr: { subtitle: 'x' } } })).toEqual({ 'text.tr.title': 'sites.editor.blocks.error.required' });
    expect(keys('hero', { config: {}, text: { tr: { title: '' } } })).toEqual({ 'text.tr.title': 'sites.editor.blocks.error.required' });
  });

  it('maps length, link, url and item limits to translated keys with their numbers', () => {
    expect(keys('hero', { config: {}, text: { tr: { title: 'x'.repeat(201) } } })).toEqual({ 'text.tr.title': 'sites.editor.blocks.error.tooLong' });
    expect(blockErrors('hero', { config: {}, text: { tr: { title: 'x'.repeat(201) } } })['text.tr.title'].params).toEqual({ max: 200 });
    expect(keys('hero', { config: {}, text: { tr: { title: 'T', primaryCtaHref: 'javascript:alert(1)' } } })).toEqual({ 'text.tr.primaryCtaHref': 'sites.editor.blocks.error.invalidHref' });
    expect(keys('hero', { config: { imageUrl: 'http://x.test/a.png' }, text: {} })).toEqual({ 'config.imageUrl': 'sites.editor.blocks.error.httpsOnly' });
    expect(keys('hero', { config: { imageUrl: 'not a url' }, text: {} })['config.imageUrl']).toBe('sites.editor.blocks.error.invalidUrl');
    const many = Array.from({ length: 31 }, (_, i) => ({ question: `Q${i}`, answer: 'A' }));
    expect(keys('faq', { config: {}, text: { tr: { items: many } } })).toEqual({ 'text.tr.items': 'sites.editor.blocks.error.tooMany' });
    expect(keys('lead_form', { config: { fields: ['fullName'] }, text: {} })).toEqual({ 'config.fields': 'sites.editor.blocks.error.tooFew' });
  });

  it('points at the exact item and field of a repeatable list', () => {
    expect(keys('faq', { config: {}, text: { tr: { items: [{ question: 'Q', answer: 'A' }, { question: 'Q2' }] } } })).toEqual({ 'text.tr.items.1.answer': 'sites.editor.blocks.error.required' });
  });
});

describe('block form labels and new blocks', () => {
  const tr = BUNDLED_MESSAGES.tr;
  const en = BUNDLED_MESSAGES.en;

  it('has a Turkish and an English label for every derived field, item field and choice', () => {
    const missing: string[] = [];
    const check = (key: string) => {
      if (!(key in tr) || !(key in en)) missing.push(key);
    };
    const visit = (type: (typeof BLOCK_TYPES)[number], fields: readonly BlockFormField[]) => {
      for (const field of fields) {
        check(fieldLabelKey(type, field));
        if (field.kind === 'choice_list') for (const choice of field.choices ?? []) check(choiceLabelKey(field.key, choice));
        if (field.itemFields) visit(type, field.itemFields);
      }
    };
    for (const spec of deriveAllBlockFormSpecs()) {
      visit(spec.type, spec.config);
      visit(spec.type, spec.text);
    }
    expect(Array.from(new Set(missing))).toEqual([]);
    expect(LEAD_FORM_FIELDS.every((f) => choiceLabelKey('fields', f) in tr)).toBe(true);
  });

  it.each(['tr', 'en'] as const)('creates valid starter data for every block type in %s', (locale) => {
    const t = createTranslator({ locale, messages: BUNDLED_MESSAGES[locale], fallback: BUNDLED_MESSAGES.tr });
    for (const type of BLOCK_TYPES) {
      const data = newBlockData(type, locale, t);
      expect(BLOCK_SCHEMAS[type].safeParse(data).success).toBe(true);
      expect(blockErrors(type, data)).toEqual({});
    }
  });

  it('uses the anchor of the contact block of the new block language', () => {
    const t = createTranslator({ locale: 'en', messages: BUNDLED_MESSAGES.en, fallback: BUNDLED_MESSAGES.tr });
    expect(getAt(newBlockData('cta', 'tr', t), ['text', 'tr', 'buttonHref'])).toBe('#iletisim');
    expect(getAt(newBlockData('cta', 'en', t), ['text', 'en', 'buttonHref'])).toBe('#contact');
  });
});
