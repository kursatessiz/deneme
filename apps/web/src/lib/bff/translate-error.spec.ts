import { translateApiError } from './translate-error';

describe('translateApiError', () => {
  const restricted = { statusCode: 403, code: 'BILLING_RESTRICTED', message: 'Turkish diagnostic text' };

  it('replaces the message of a known code with the viewer-language translation', () => {
    expect(translateApiError(restricted, 'en', null)?.message).toMatch(/^This account is restricted/);
    expect(translateApiError(restricted, undefined, 'en-GB,en;q=0.9')?.message).toMatch(/^This account is restricted/);
    expect(translateApiError(restricted, undefined, null)?.message).toMatch(/^Hesabınız kısıtlı modda/);
    expect(translateApiError(restricted, 'en', null)?.code).toBe('BILLING_RESTRICTED');
  });

  it('translates an apiErrors key into English for an English viewer and keeps Turkish otherwise', () => {
    const body = { statusCode: 404, code: 'apiErrors.common.memberNotFound', message: 'Üye bulunamadı' };
    expect(translateApiError(body, 'en', null)?.message).toBe('Member not found');
    expect(translateApiError(body, undefined, 'en-US,en;q=0.8')?.message).toBe('Member not found');
    expect(translateApiError(body, 'tr', null)?.message).toBe('Üye bulunamadı');
    expect(translateApiError(body, undefined, null)?.message).toBe('Üye bulunamadı');
    expect(translateApiError(body, 'en', null)?.code).toBe('apiErrors.common.memberNotFound');
  });

  it('interpolates params and plural forms', () => {
    const op = { code: 'apiErrors.growth.invalidOperator', message: 'Geçersiz işlem: ~', params: { op: '~' } };
    expect(translateApiError(op, 'en', null)?.message).toBe('Invalid operator: ~');
    const days = { code: 'apiErrors.members.freezeDaysExceeded', message: '', params: { count: 1 } };
    expect(translateApiError(days, 'en', null)?.message).toBe('This package can be frozen for at most 1 day.');
  });

  it('translates module codes and codes that keep a messageKey', () => {
    expect(translateApiError({ code: 'LOYALTY_DISABLED', message: 'x' }, 'en', null)?.message).toMatch(/loyalty/i);
    const legacy = { code: 'TRANSLATION_JOB_ACTIVE', messageKey: 'apiErrors.ai.translationJobActive', message: 'x' };
    expect(translateApiError(legacy, 'en', null)?.message).toBe('There is already a translation job in progress for this language.');
  });

  it('leaves other errors untouched', () => {
    const other = { statusCode: 409, code: 'SOME_UNKNOWN_CODE', message: 'x' };
    expect(translateApiError(other, 'en', null)).toBe(other);
    expect(translateApiError({ message: 'y' }, 'en', null)).toEqual({ message: 'y' });
    expect(translateApiError(null, 'en', null)).toBeNull();
  });
});
