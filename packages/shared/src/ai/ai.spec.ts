import {
  AI_FALLBACK_PRICE,
  DEFAULT_AI_MODELS,
  aiBudgetMonthOf,
  aiBudgetMonthStart,
  centsToMicroUsd,
  estimateCostMicroUsd,
  microUsdToCents,
  resolveModelPrice,
} from './models';
import { AiDraftSchema, SetAiApiKeySchema, UpdateAiSettingsSchema, isAiErrorCode } from './api';
import {
  StartTranslationJobSchema,
  baseWithPluralExtensions,
  buildTranslationUnits,
  chunkBatches,
  containsHtml,
  isPluralExtensionKey,
  pluralCategoriesFor,
  pluralGroupsOf,
  sourceForKey,
  validateTranslatedValue,
} from './translation';

const BASE = {
  'common.save': 'Kaydet',
  'common.greeting': 'Merhaba {name}',
  'common.itemCount.one': '{count} kayıt',
  'common.itemCount.other': '{count} kayıt',
  'nav.home': 'Ana sayfa',
  'nav.welcome': '{name}, hoş geldin',
};

describe('AI models and cost', () => {
  it('defaults to the cheapest model that does each task', () => {
    expect(DEFAULT_AI_MODELS).toEqual({
      TRANSLATION: 'claude-sonnet-5',
      COPYWRITING: 'claude-sonnet-5',
      REPLY_SUGGESTION: 'claude-haiku-4-5-20251001',
      MARKETING_DRAFT: 'claude-sonnet-5',
      MARKETING_ANALYSIS: 'claude-sonnet-5',
      MARKETING_RESEARCH: 'claude-sonnet-5',
      MARKETING_WEEKLY_SUMMARY: 'claude-haiku-4-5-20251001',
    });
  });

  it('prices a call in micro-USD from input, output and cache tokens', () => {
    const price = resolveModelPrice('claude-sonnet-5');
    // 1000 x 2 + 500 x 10 + 2000 x 2.5 + 10000 x 0.2 = 2000 + 5000 + 5000 + 2000
    expect(
      estimateCostMicroUsd({ inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 2000, cacheReadTokens: 10000 }, price),
    ).toBe(14_000);
  });

  it('rounds fractional micro-dollars', () => {
    const price = resolveModelPrice('claude-haiku-4-5-20251001');
    expect(estimateCostMicroUsd({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 7 }, price)).toBe(1);
  });

  it('prices a dated snapshot like its alias, lets overrides win and falls back high for unknown models', () => {
    expect(resolveModelPrice('claude-sonnet-5-20260101')).toEqual(resolveModelPrice('claude-sonnet-5'));
    const override = { inputPerMTok: 9, outputPerMTok: 9, cacheWritePerMTok: 9, cacheReadPerMTok: 9 };
    expect(resolveModelPrice('claude-sonnet-5', { 'claude-sonnet-5': override })).toEqual(override);
    expect(resolveModelPrice('some-new-model')).toEqual(AI_FALLBACK_PRICE);
  });

  it('converts cents and micro-dollars, rounding spend up', () => {
    expect(centsToMicroUsd(500)).toBe(5_000_000);
    expect(microUsdToCents(1)).toBe(1);
    expect(microUsdToCents(20_000)).toBe(2);
  });

  it('uses UTC calendar months for budgets', () => {
    const at = new Date('2026-10-31T23:30:00.000Z');
    expect(aiBudgetMonthOf(at)).toBe('2026-10');
    expect(aiBudgetMonthStart(at).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('AI request schemas', () => {
  it('accepts a printable key and refuses short or spaced ones', () => {
    expect(SetAiApiKeySchema.safeParse({ apiKey: 'sk-ant-api03-abcdefghijklmnop' }).success).toBe(true);
    expect(SetAiApiKeySchema.safeParse({ apiKey: 'short' }).success).toBe(false);
    expect(SetAiApiKeySchema.safeParse({ apiKey: 'sk-ant-api03 abcdefghijklmnop' }).success).toBe(false);
  });

  it('validates model ids and price overrides', () => {
    expect(UpdateAiSettingsSchema.safeParse({ models: { TRANSLATION: 'claude-opus-5' } }).success).toBe(true);
    expect(UpdateAiSettingsSchema.safeParse({ models: { TRANSLATION: 'Claude Opus!' } }).success).toBe(false);
    expect(UpdateAiSettingsSchema.safeParse({ priceOverrides: { 'claude-x': { inputPerMTok: -1, outputPerMTok: 1, cacheWritePerMTok: 1, cacheReadPerMTok: 1 } } }).success).toBe(false);
  });

  it('defaults the draft tone and requires a locale', () => {
    const parsed = AiDraftSchema.parse({ kind: 'SMS', brief: 'Yeni dönem', locale: 'tr' });
    expect(parsed.tone).toBe('FRIENDLY');
    expect(AiDraftSchema.safeParse({ kind: 'SMS', brief: 'Yeni dönem' }).success).toBe(false);
  });

  it('recognises error codes', () => {
    expect(isAiErrorCode('AI_MONTHLY_LIMIT_REACHED')).toBe(true);
    expect(isAiErrorCode('NOPE')).toBe(false);
  });

  it('requires confirmation to overwrite every translation', () => {
    expect(StartTranslationJobSchema.safeParse({ overwrite: true }).success).toBe(false);
    expect(StartTranslationJobSchema.safeParse({ overwrite: true, confirmOverwrite: true }).success).toBe(true);
    expect(StartTranslationJobSchema.parse({})).toEqual({ namespaces: [], overwrite: false });
  });
});

describe('plural forms', () => {
  it('lists the CLDR categories a language needs', () => {
    expect(pluralCategoriesFor('tr')).toEqual(['one', 'other']);
    expect(pluralCategoriesFor('ru')).toEqual(['one', 'few', 'many', 'other']);
    expect(pluralCategoriesFor('ar')).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
    expect(pluralCategoriesFor('ja')).toEqual(['other']);
    expect(pluralCategoriesFor('not a locale!')).toEqual(['one', 'other']);
  });

  it('groups plural keys and adds the forms a language needs', () => {
    expect([...pluralGroupsOf(BASE).keys()]).toEqual(['common.itemCount']);
    const ru = baseWithPluralExtensions(BASE, 'ru');
    expect(ru['common.itemCount.few']).toBe('{count} kayıt');
    expect(ru['common.itemCount.many']).toBe('{count} kayıt');
    expect(Object.keys(baseWithPluralExtensions(BASE, 'en'))).toHaveLength(Object.keys(BASE).length);
    expect(isPluralExtensionKey('common.itemCount.few', 'ru', BASE)).toBe(true);
    expect(isPluralExtensionKey('common.itemCount.few', 'en', BASE)).toBe(false);
    expect(isPluralExtensionKey('common.itemCount.one', 'ru', BASE)).toBe(false);
    expect(sourceForKey('common.itemCount.many', BASE)).toBe('{count} kayıt');
  });
});

describe('buildTranslationUnits', () => {
  const reference = { 'common.save': 'Save', 'common.itemCount.one': '{count} record', 'common.itemCount.other': '{count} records' };

  it('covers only missing keys by default, with English as reference', () => {
    const units = buildTranslationUnits({ base: BASE, reference, current: { 'nav.home': 'Startseite' }, locale: 'de', namespaces: [], overwrite: false });
    expect(units.map((u) => u.id)).toEqual(['common.greeting', 'common.itemCount.*', 'common.save', 'nav.welcome']);
    const save = units.find((u) => u.id === 'common.save');
    expect(save).toMatchObject({ kind: 'single', source: 'Kaydet', reference: 'Save', placeholders: [] });
    const greeting = units.find((u) => u.id === 'common.greeting');
    expect(greeting).toMatchObject({ reference: null, placeholders: ['name'] });
  });

  it('asks for every plural form the target needs in one unit', () => {
    const units = buildTranslationUnits({ base: BASE, reference, current: {}, locale: 'ru', namespaces: ['common'], overwrite: false });
    const plural = units.find((u) => u.kind === 'plural');
    expect(plural).toMatchObject({
      id: 'common.itemCount.*',
      group: 'common.itemCount',
      categories: ['one', 'few', 'many', 'other'],
      placeholders: ['count'],
      referenceForms: { one: '{count} record', other: '{count} records' },
    });
    expect(units.every((u) => (u.kind === 'single' ? u.key : u.group).startsWith('common.'))).toBe(true);
  });

  it('re-translates a plural group when one needed form is missing', () => {
    const current = { 'common.itemCount.one': 'a', 'common.itemCount.other': 'b', 'common.itemCount.few': 'c' };
    const units = buildTranslationUnits({ base: BASE, reference: null, current, locale: 'ru', namespaces: ['common.itemCount'], overwrite: false });
    expect(units.map((u) => u.id)).toEqual(['common.itemCount.*']);
  });

  it('includes existing values when overwriting and filters by namespace', () => {
    const current = Object.fromEntries(Object.keys(BASE).map((k) => [k, 'x']));
    expect(buildTranslationUnits({ base: BASE, reference: null, current, locale: 'de', namespaces: [], overwrite: false })).toHaveLength(0);
    const all = buildTranslationUnits({ base: BASE, reference: null, current, locale: 'de', namespaces: ['nav'], overwrite: true });
    expect(all.map((u) => u.id)).toEqual(['nav.home', 'nav.welcome']);
  });
});

describe('batching and validation', () => {
  it('splits work into batches of the given size', () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    const batches = chunkBatches(items, 50);
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(batches.flat()).toEqual(items);
    expect(chunkBatches([], 50)).toEqual([]);
    expect(() => chunkBatches(items, 0)).toThrow();
  });

  it('keeps placeholders exactly and refuses markup', () => {
    expect(validateTranslatedValue('Merhaba {name}', 'Hallo {name}')).toBeNull();
    expect(validateTranslatedValue('Merhaba {name}', 'Hallo {Name}')).toBe('PLACEHOLDER_MISMATCH');
    expect(validateTranslatedValue('Merhaba {name}', 'Hallo')).toBe('PLACEHOLDER_MISMATCH');
    expect(validateTranslatedValue('Kaydet', 'Speichern {x}')).toBe('PLACEHOLDER_MISMATCH');
    expect(validateTranslatedValue('Kaydet', '<b>Speichern</b>')).toBe('HTML');
    expect(validateTranslatedValue('Kaydet', '   ')).toBe('EMPTY');
    expect(validateTranslatedValue('Kaydet', 'x'.repeat(2001))).toBe('TOO_LONG');
    expect(containsHtml('a < b and c > d')).toBe(false);
    expect(containsHtml('<script>alert(1)</script>')).toBe(true);
    const start = Date.now();
    expect(containsHtml(`<!${'<!'.repeat(50000)}`)).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
