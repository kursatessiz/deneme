import {
  computeCac,
  computeCpl,
  computeRoas,
  CreateAdConnectionSchema,
  credentialLast4Of,
  validateCredentialsFor,
} from './ads';

describe('ad connection credentials', () => {
  it('validates Meta credentials and rejects Google-shaped credentials for a Meta connection', () => {
    const valid = CreateAdConnectionSchema.safeParse({
      platform: 'META',
      label: 'Ana hesap',
      externalAccountId: 'act_123',
      credentials: { accessToken: 'EAABsecretsecret', pixelId: '123456789' },
      isTestMode: false,
    });
    expect(valid.success).toBe(true);

    const invalid = CreateAdConnectionSchema.safeParse({
      platform: 'META',
      label: 'Ana hesap',
      externalAccountId: 'act_123',
      credentials: { refreshToken: 'x', clientId: 'y' },
      isTestMode: false,
    });
    expect(invalid.success).toBe(false);
  });

  it('validates Google Ads credentials (10-digit customer ids)', () => {
    const ok = validateCredentialsFor('GOOGLE', {
      clientId: 'a',
      clientSecret: 'b',
      refreshToken: 'c',
      developerToken: 'd',
      loginCustomerId: '1234567890',
      customerId: '0987654321',
      conversionId: 'AW-123456789',
    });
    expect(ok.success).toBe(true);
    const bad = validateCredentialsFor('GOOGLE', {
      clientId: 'a',
      clientSecret: 'b',
      refreshToken: 'c',
      developerToken: 'd',
      loginCustomerId: '123',
      customerId: '0987654321',
      conversionId: 'AW-123456789',
    });
    expect(bad.success).toBe(false);
  });

  it('returns only the last 4 characters of the identifying token', () => {
    expect(credentialLast4Of('META', { accessToken: 'EAABsecretsecretABCD', pixelId: '1' })).toBe('ABCD');
    expect(
      credentialLast4Of('GOOGLE', {
        clientId: 'a',
        clientSecret: 'b',
        refreshToken: '1//secretWXYZ',
        developerToken: 'd',
        loginCustomerId: '1234567890',
        customerId: '0987654321',
        conversionId: 'AW-123456789',
      }),
    ).toBe('WXYZ');
  });
});

describe('report math', () => {
  it('computes CPL, CAC and ROAS, null when there is nothing to divide', () => {
    expect(computeCpl(1000, 20)).toBe(50);
    expect(computeCpl(1000, 0)).toBeNull();
    expect(computeCpl(0, 20)).toBeNull();

    expect(computeCac(3000, 3)).toBe(1000);
    expect(computeCac(3000, 0)).toBeNull();

    expect(computeRoas(5000, 1000)).toBe(5);
    expect(computeRoas(5000, 0)).toBeNull();
  });
});
