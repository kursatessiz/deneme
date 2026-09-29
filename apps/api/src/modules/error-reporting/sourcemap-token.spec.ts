import { sourcemapTokenValid } from './sourcemap-token';

const TOKEN = 'unit-sourcemap-token-unit-sourcemap-token';

describe('sourcemapTokenValid', () => {
  it('accepts the token as x-sourcemap-token or as a bearer token', () => {
    expect(sourcemapTokenValid({ headers: { 'x-sourcemap-token': TOKEN } }, TOKEN)).toBe(true);
    expect(sourcemapTokenValid({ headers: { authorization: `Bearer ${TOKEN}` } }, TOKEN)).toBe(true);
  });

  it('refuses a missing, wrong or different-length token', () => {
    expect(sourcemapTokenValid({ headers: {} }, TOKEN)).toBe(false);
    expect(sourcemapTokenValid({ headers: { 'x-sourcemap-token': `${TOKEN}x` } }, TOKEN)).toBe(false);
    expect(sourcemapTokenValid({ headers: { 'x-sourcemap-token': TOKEN.replace('u', 'v') } }, TOKEN)).toBe(false);
    expect(sourcemapTokenValid({ headers: { authorization: TOKEN } }, TOKEN)).toBe(false);
  });

  it('is disabled when no token is configured, even for an empty presented token', () => {
    expect(sourcemapTokenValid({ headers: { 'x-sourcemap-token': '' } }, undefined)).toBe(false);
    expect(sourcemapTokenValid({ headers: { 'x-sourcemap-token': TOKEN } }, '')).toBe(false);
  });
});
