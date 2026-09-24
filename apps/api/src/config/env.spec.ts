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
});
