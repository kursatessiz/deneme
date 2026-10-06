import {
  API_ERROR_KEY_PREFIX,
  MODULE_API_ERROR_CODE_KEYS,
  apiErrorBaseMessage,
  apiErrorBaseMessageForCode,
  apiErrorMessageKey,
  buildApiErrorResponse,
  isApiErrorKey,
  translateApiErrorBody,
} from './api-errors';
import { BASE_MESSAGES, BUNDLED_MESSAGES } from './i18n/messages';
import { createTranslator } from './i18n/translator';

const tr = createTranslator({ locale: 'tr', messages: BUNDLED_MESSAGES.tr, fallback: BASE_MESSAGES });
const en = createTranslator({ locale: 'en', messages: BUNDLED_MESSAGES.en, fallback: BASE_MESSAGES });

describe('apiErrors catalogue', () => {
  it('has Turkish and English text for every key', () => {
    const keys = Object.keys(BASE_MESSAGES).filter((k) => k.startsWith(API_ERROR_KEY_PREFIX));
    expect(keys.length).toBeGreaterThan(300);
    for (const key of keys) {
      expect(BUNDLED_MESSAGES.tr[key]).toBeTruthy();
      expect(BUNDLED_MESSAGES.en[key]).toBeTruthy();
    }
  });

  it('keeps messages short plain text without markup', () => {
    for (const [key, value] of Object.entries(BASE_MESSAGES)) {
      if (!key.startsWith(API_ERROR_KEY_PREFIX)) continue;
      expect(value).not.toMatch(/[<>]\s*\/?\w+>/);
      expect(value.length).toBeLessThan(260);
    }
  });

  it('translates every module error code to an existing key', () => {
    for (const key of Object.values(MODULE_API_ERROR_CODE_KEYS)) expect(BASE_MESSAGES).toHaveProperty([key]);
  });
});

describe('isApiErrorKey', () => {
  it('accepts catalogue keys, including a plural key by its base name', () => {
    expect(isApiErrorKey('apiErrors.common.memberNotFound')).toBe(true);
    expect(isApiErrorKey('apiErrors.branches.hasUpcomingSessions')).toBe(true);
  });

  it('rejects other codes', () => {
    expect(isApiErrorKey('BILLING_RESTRICTED')).toBe(false);
    expect(isApiErrorKey('apiErrors.nope.missing')).toBe(false);
    expect(isApiErrorKey(undefined)).toBe(false);
  });
});

describe('buildApiErrorResponse', () => {
  it('builds code, Turkish message and params', () => {
    expect(buildApiErrorResponse('apiErrors.common.memberNotFound')).toEqual({ code: 'apiErrors.common.memberNotFound', message: 'Üye bulunamadı' });
    expect(buildApiErrorResponse('apiErrors.growth.unknownField', { field: 'x' })).toEqual({
      code: 'apiErrors.growth.unknownField',
      message: 'Bilinmeyen alan: x',
      params: { field: 'x' },
    });
  });

  it('puts the key in messageKey when an older code is kept', () => {
    expect(buildApiErrorResponse('apiErrors.ai.translationJobActive', undefined, 'TRANSLATION_JOB_ACTIVE')).toMatchObject({
      code: 'TRANSLATION_JOB_ACTIVE',
      messageKey: 'apiErrors.ai.translationJobActive',
    });
  });

  it('exposes the base text helpers', () => {
    expect(apiErrorBaseMessage('apiErrors.common.memberNotFound')).toBe('Üye bulunamadı');
    expect(apiErrorBaseMessageForCode('RETAIL_PRODUCT_NOT_FOUND')).toBe('Ürün bulunamadı.');
    expect(apiErrorBaseMessageForCode('UNKNOWN')).toBeNull();
  });
});

describe('apiErrorMessageKey', () => {
  it('resolves apiErrors keys, shared codes and module codes', () => {
    expect(apiErrorMessageKey('apiErrors.common.memberNotFound')).toBe('apiErrors.common.memberNotFound');
    expect(apiErrorMessageKey('BILLING_RESTRICTED')).toBe('billing.error.BILLING_RESTRICTED');
    expect(apiErrorMessageKey('RETAIL_PRODUCT_NOT_FOUND')).toBe('retail.error.RETAIL_PRODUCT_NOT_FOUND');
    expect(apiErrorMessageKey('EVENT_FULL')).toBe('events.error.EVENT_FULL');
    expect(apiErrorMessageKey('SOMETHING')).toBeNull();
    expect(apiErrorMessageKey(42)).toBeNull();
  });
});

describe('translateApiErrorBody', () => {
  const body = { statusCode: 404, code: 'apiErrors.common.memberNotFound', message: 'Üye bulunamadı' };

  it('replaces the message with the viewer language', () => {
    expect(translateApiErrorBody(body, en)).toEqual({ ...body, message: 'Member not found' });
    expect(translateApiErrorBody(body, tr)).toEqual(body);
  });

  it('interpolates params', () => {
    const withParams = { code: 'apiErrors.growth.unknownField', message: 'Bilinmeyen alan: x', params: { field: 'plan.tier' } };
    expect(translateApiErrorBody(withParams, en)?.message).toBe('Unknown field: plan.tier');
  });

  it('picks the plural form from count', () => {
    const one = { code: 'apiErrors.members.freezeDaysExceeded', message: '', params: { count: 1 } };
    const many = { code: 'apiErrors.members.freezeDaysExceeded', message: '', params: { count: 30 } };
    expect(translateApiErrorBody(one, en)?.message).toBe('This package can be frozen for at most 1 day.');
    expect(translateApiErrorBody(many, en)?.message).toBe('This package can be frozen for at most 30 days.');
  });

  it('ignores params that are not text or numbers', () => {
    const odd = { code: 'apiErrors.growth.unknownField', message: 'm', params: { field: 'a', other: { nested: true } } };
    expect(translateApiErrorBody(odd, en)?.message).toBe('Unknown field: a');
  });

  it('uses messageKey for an error that keeps an older code', () => {
    const legacy = { code: 'TRANSLATION_JOB_ACTIVE', messageKey: 'apiErrors.ai.translationJobActive', message: 'Bu dil için süren bir çeviri işi var.' };
    expect(translateApiErrorBody(legacy, en)?.message).toBe('There is already a translation job in progress for this language.');
  });

  it('translates shared and module codes', () => {
    expect(translateApiErrorBody({ code: 'BILLING_RESTRICTED', message: 'x' }, en)?.message).toMatch(/^This account is restricted/);
    expect(translateApiErrorBody({ code: 'RETAIL_PRODUCT_NOT_FOUND', message: 'x' }, en)?.message).toBe('Product not found.');
  });

  it('returns the body as is without a translatable code', () => {
    const unknown = { code: 'NOPE', message: 'm' };
    expect(translateApiErrorBody(unknown, en)).toBe(unknown);
    const plain = { message: 'm' };
    expect(translateApiErrorBody(plain, en)).toBe(plain);
    expect(translateApiErrorBody(null, en)).toBeNull();
  });
});
