import { validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('accepts a minimal development config and applies defaults', () => {
    const env = validateEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.SMS_PROVIDER).toBe('MOCK');
  });

  it('rejects a missing or short JWT secret', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: undefined })).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('requires Redis and explicit CORS origins in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/REDIS_URL/);
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', REDIS_URL: 'redis://r:6379', CORS_ORIGIN: '*' }),
    ).toThrow(/CORS_ORIGIN/);
    expect(
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        REDIS_URL: 'redis://r:6379',
        CORS_ORIGIN: 'https://panel.example.com',
      }).NODE_ENV,
    ).toBe('production');
  });

  it('accepts OTP_TEST_CODE only in the test environment', () => {
    expect(validateEnv({ ...base, NODE_ENV: 'test', OTP_TEST_CODE: '482915' }).OTP_TEST_CODE).toBe('482915');
    expect(() => validateEnv({ ...base, NODE_ENV: 'development', OTP_TEST_CODE: '482915' })).toThrow(/OTP_TEST_CODE/);
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        REDIS_URL: 'redis://r:6379',
        CORS_ORIGIN: 'https://panel.example.com',
        OTP_TEST_CODE: '482915',
      }),
    ).toThrow(/OTP_TEST_CODE/);
  });
});
