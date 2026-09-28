import {
  BASE_MESSAGES,
  BUNDLED_MESSAGES,
  EN_NAMESPACES,
  TR_NAMESPACES,
} from './messages';
import { createTranslator, interpolate, placeholdersOf, pluralBaseOf } from './translator';
import { parseAcceptLanguage, resolveLocale } from './locales';
import {
  buildLanguagePack,
  LanguagePackError,
  MessageKeySchema,
  packCompletion,
  packToCsv,
  parseCsvPack,
  parseJsonPack,
  validatePackMessages,
} from './pack';

describe('bundled catalogues', () => {
  it('has no key defined in two namespaces', () => {
    const total = TR_NAMESPACES.reduce((n, ns) => n + Object.keys(ns).length, 0);
    expect(Object.keys(BASE_MESSAGES)).toHaveLength(total);
    const enTotal = EN_NAMESPACES.reduce((n, ns) => n + Object.keys(ns).length, 0);
    expect(Object.keys(BUNDLED_MESSAGES.en)).toHaveLength(enTotal);
  });

  it('keeps every namespace file prefixed by one namespace', () => {
    for (const ns of TR_NAMESPACES) {
      const prefixes = new Set(Object.keys(ns).map((k) => k.split('.')[0]));
      expect(prefixes.size).toBe(1);
    }
  });

  it('uses valid keys only', () => {
    for (const key of Object.keys(BASE_MESSAGES)) {
      expect(MessageKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it('translates every key into English with the same placeholders', () => {
    const en = BUNDLED_MESSAGES.en;
    expect(Object.keys(en).sort()).toEqual(Object.keys(BASE_MESSAGES).sort());
    const result = validatePackMessages({ ...en }, BASE_MESSAGES);
    expect(result.placeholderMismatches).toEqual([]);
    expect(result.emptyKeys).toEqual([]);
  });

  it('contains no emoji', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const catalogue of Object.values(BUNDLED_MESSAGES)) {
      for (const value of Object.values(catalogue)) expect(emoji.test(value)).toBe(false);
    }
  });
});

describe('translator', () => {
  const fallback = { 'a.hello': 'Merhaba {name}', 'a.only': 'Yalnız Türkçe', 'a.n.one': '{count} öğe', 'a.n.other': '{count} öğe' };
  const messages = { 'a.hello': 'Hello {name}', 'a.n.one': '{count} item', 'a.n.other': '{count} items', 'a.blank': '' };

  it('interpolates named params and leaves unknown ones', () => {
    expect(interpolate('Hi {name} {missing}', { name: 'Ada' })).toBe('Hi Ada {missing}');
  });

  it('does not read inherited params', () => {
    expect(interpolate('{constructor}', {})).toBe('{constructor}');
  });

  it('falls back to the base language, then to the key', () => {
    const t = createTranslator({ locale: 'en', messages, fallback });
    expect(t('a.hello', { name: 'Ada' })).toBe('Hello Ada');
    expect(t('a.only')).toBe('Yalnız Türkçe');
    expect(t('a.none')).toBe('a.none');
    expect(t('constructor')).toBe('constructor');
  });

  it('picks plural forms for the locale', () => {
    const t = createTranslator({ locale: 'en', messages, fallback });
    expect(t('a.n', { count: 1 })).toBe('1 item');
    expect(t('a.n', { count: 1200 })).toBe('1,200 items');
  });

  it('reports each missing key once', () => {
    const onMissing = jest.fn();
    const t = createTranslator({ locale: 'en', messages, fallback, onMissing });
    t('x.y');
    t('x.y');
    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it('finds placeholders and plural bases', () => {
    expect(placeholdersOf('{b} and {a} and {b}')).toEqual(['a', 'b']);
    expect(pluralBaseOf('a.n.one')).toBe('a.n');
    expect(pluralBaseOf('a.name')).toBeNull();
  });
});

describe('locale resolution', () => {
  it('prefers the first enabled candidate and matches by language', () => {
    expect(resolveLocale(['tr', 'en'], [null, 'de', 'en-GB'])).toBe('en');
    expect(resolveLocale(['tr', 'en'], ['fr'])).toBe('tr');
  });

  it('orders Accept-Language by quality', () => {
    expect(parseAcceptLanguage('de;q=0.5, en-gb, tr;q=0.8, *;q=0.1')).toEqual(['en-GB', 'tr', 'de']);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });
});

describe('language packs', () => {
  const base = { 'a.hello': 'Merhaba {name}', 'a.bye': 'Güle güle', 'a.formula': '=1+1' };

  it('rejects placeholder changes, skips empty and unknown keys', () => {
    const result = validatePackMessages(
      { 'a.hello': 'Hello {nme}', 'a.bye': '  ', 'a.gone': 'x', constructor: 'x' },
      base,
    );
    expect(result.accepted).toEqual({});
    expect(result.placeholderMismatches).toEqual([{ key: 'a.hello', expected: ['name'], actual: ['nme'] }]);
    expect(result.emptyKeys).toEqual(['a.bye']);
    expect(result.unknownKeys).toEqual(['a.gone', 'constructor']);
  });

  it('computes completion over base keys', () => {
    expect(packCompletion({ 'a.hello': 'Hi {name}', 'a.bye': '' }, base)).toEqual({
      translatedKeys: 1,
      totalKeys: 3,
      completion: 1 / 3,
    });
  });

  it('round-trips through JSON', () => {
    const pack = buildLanguagePack({ locale: 'en', messages: { 'a.hello': 'Hello {name}' }, base });
    expect(pack.messages).toEqual({ 'a.bye': '', 'a.formula': '', 'a.hello': 'Hello {name}' });
    expect(parseJsonPack(JSON.stringify(pack), 'en').messages).toEqual(pack.messages);
    expect(() => parseJsonPack(JSON.stringify(pack), 'de')).toThrow(LanguagePackError);
    expect(() => parseJsonPack('{', 'en')).toThrow(LanguagePackError);
    expect(() => parseJsonPack(JSON.stringify({ ...pack, messages: { __proto__x: 'a' } }), 'en')).toThrow(LanguagePackError);
  });

  it('round-trips through CSV with quotes, newlines, Turkish text and formula guards', () => {
    const pack = buildLanguagePack({
      locale: 'en',
      messages: { 'a.hello': 'Hello, "{name}"\nwelcome', 'a.bye': 'Şükran', 'a.formula': '=2+2' },
      base,
    });
    const csv = packToCsv(pack, base);
    expect(csv.startsWith('﻿key,source,translation\r\n')).toBe(true);
    expect(csv).toContain("'=2+2");
    expect(parseCsvPack(csv)).toEqual(pack.messages);
  });

  it('reads semicolon-separated CSV and rejects bad input', () => {
    expect(parseCsvPack('key;source;translation\na.bye;Güle güle;Bye\n')).toEqual({ 'a.bye': 'Bye' });
    expect(() => parseCsvPack('foo,bar\n')).toThrow(LanguagePackError);
    expect(() => parseCsvPack('key,translation\n"a.bye,x\n')).toThrow(LanguagePackError);
    expect(() => parseCsvPack('key,translation\n__proto__,x\n')).toThrow(LanguagePackError);
  });
});
