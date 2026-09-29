import { translateApiError } from './translate-error';

describe('translateApiError', () => {
  const restricted = { statusCode: 403, code: 'BILLING_RESTRICTED', message: 'Turkish diagnostic text' };

  it('replaces the message of a known code with the viewer-language translation', () => {
    expect(translateApiError(restricted, 'en', null)?.message).toMatch(/^This account is restricted/);
    expect(translateApiError(restricted, undefined, 'en-GB,en;q=0.9')?.message).toMatch(/^This account is restricted/);
    expect(translateApiError(restricted, undefined, null)?.message).toMatch(/^Hesabınız kısıtlı modda/);
    expect(translateApiError(restricted, 'en', null)?.code).toBe('BILLING_RESTRICTED');
  });

  it('leaves other errors untouched', () => {
    const other = { statusCode: 409, code: 'LOYALTY_DISABLED', message: 'x' };
    expect(translateApiError(other, 'en', null)).toBe(other);
    expect(translateApiError({ message: 'y' }, 'en', null)).toEqual({ message: 'y' });
    expect(translateApiError(null, 'en', null)).toBeNull();
  });
});
