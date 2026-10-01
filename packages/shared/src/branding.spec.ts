import { buildPoweredByUrl, originForPlatformHost, resolvePoweredBy, shouldShowPoweredBy } from './branding';

describe('powered-by badge', () => {
  it('builds the platform link with the tenant attribution query', () => {
    expect(buildPoweredByUrl('platform.example', 'zen-studio')).toBe('https://platform.example/?utm_source=tenant-site&utm_medium=badge&utm_campaign=zen-studio');
  });

  it('uses plain http only for the local development host', () => {
    expect(originForPlatformHost('localhost')).toBe('http://localhost');
    expect(originForPlatformHost('localhost:3000')).toBe('http://localhost:3000');
    expect(originForPlatformHost('app.example.com')).toBe('https://app.example.com');
  });

  it('encodes an unusual campaign value', () => {
    const url = buildPoweredByUrl('platform.example', 'a b&c');
    expect(url).toContain('utm_campaign=a%20b%26c');
  });

  it('hides the badge for the platform tenant and when the entitlement is on', () => {
    expect(shouldShowPoweredBy({ isPlatform: false, hideBadge: false })).toBe(true);
    expect(shouldShowPoweredBy({ isPlatform: false, hideBadge: true })).toBe(false);
    expect(shouldShowPoweredBy({ isPlatform: true, hideBadge: false })).toBe(false);
  });

  it('exposes no link when the badge is hidden', () => {
    expect(resolvePoweredBy({ isPlatform: false, hideBadge: true, platformHost: 'p.example', studioSlug: 'x' })).toEqual({ showPoweredBy: false, poweredByUrl: null });
    expect(resolvePoweredBy({ isPlatform: false, hideBadge: false, platformHost: 'p.example', studioSlug: 'x' }).showPoweredBy).toBe(true);
  });
});
