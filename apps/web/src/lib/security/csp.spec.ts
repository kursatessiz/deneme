import { dashboardCsp, generateNonce } from './csp';

describe('generateNonce', () => {
  it('returns a base64 string and is different on every call', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a).not.toBe(b);
  });
});

describe('dashboardCsp', () => {
  it('builds a strict, nonce-based production policy', () => {
    const csp = dashboardCsp('abc123', false);

    expect(csp).toContain(`default-src 'self'`);
    expect(csp).toContain(`script-src 'self' 'nonce-abc123' 'strict-dynamic'`);
    expect(csp).toContain(`style-src 'self' 'unsafe-inline'`);
    expect(csp).toContain(`img-src 'self' data: blob: https:`);
    expect(csp).toContain(`font-src 'self' data:`);
    expect(csp).toContain(`connect-src 'self'`);
    expect(csp).toContain(`frame-ancestors 'none'`);
    expect(csp).toContain(`base-uri 'self'`);
    expect(csp).toContain(`form-action 'self'`);
    expect(csp).toContain(`object-src 'none'`);
    expect(csp).not.toContain(`'unsafe-eval'`);
  });

  it('allows unsafe-eval only in development, same convention as the public ad-pixel CSP', () => {
    const dev = dashboardCsp('abc123', true);
    expect(dev).toContain(`script-src 'self' 'nonce-abc123' 'strict-dynamic' 'unsafe-eval'`);

    const prod = dashboardCsp('abc123', false);
    expect(prod).not.toContain('unsafe-eval');
  });

  it('embeds the given nonce so each request gets a distinct policy', () => {
    const first = dashboardCsp('nonce-one', false);
    const second = dashboardCsp('nonce-two', false);
    expect(first).toContain(`'nonce-nonce-one'`);
    expect(second).toContain(`'nonce-nonce-two'`);
    expect(first).not.toBe(second);
  });
});
