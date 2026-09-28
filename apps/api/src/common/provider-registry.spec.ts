import { ProviderRegistry } from './provider-registry';

describe('ProviderRegistry', () => {
  const registry = new ProviderRegistry<string>([
    { key: 'IYZICO', adapter: 'iyzico-adapter', countries: ['TR'] },
    { key: 'PAYTR', adapter: 'paytr-adapter', countries: [] },
    { key: 'STRIPE', adapter: 'stripe-adapter', countries: ['*'] },
  ]);

  it('picks the country-specific adapter when one matches', () => {
    expect(registry.resolveFor('TR')).toBe('iyzico-adapter');
  });

  it('lists candidates: country entries first, then the wildcard', () => {
    expect(registry.candidatesFor('tr').map((e) => e.key)).toEqual(['IYZICO', 'STRIPE']);
    expect(registry.candidatesFor('US').map((e) => e.key)).toEqual(['STRIPE']);
    expect(registry.candidatesFor(null).map((e) => e.key)).toEqual(['STRIPE']);
  });

  it('falls back to the wildcard adapter for an unmatched country', () => {
    expect(registry.resolveFor('US')).toBe('stripe-adapter');
    expect(registry.resolveFor('DE')).toBe('stripe-adapter');
  });

  it('falls back to the wildcard adapter when no country is known', () => {
    expect(registry.resolveFor(null)).toBe('stripe-adapter');
    expect(registry.resolveFor(undefined)).toBe('stripe-adapter');
  });

  it('a tenant override wins over the country priority', () => {
    expect(registry.resolveFor('TR', 'PAYTR')).toBe('paytr-adapter');
  });

  it('ignores an unknown override key and falls back to country resolution', () => {
    expect(registry.resolveFor('TR', 'UNKNOWN')).toBe('iyzico-adapter');
  });

  it('is case-insensitive on keys', () => {
    expect(registry.byKey('stripe')).toBe('stripe-adapter');
  });

  it('returns null when nothing matches and there is no wildcard', () => {
    const noWildcard = new ProviderRegistry<string>([{ key: 'IYZICO', adapter: 'iyzico-adapter', countries: ['TR'] }]);
    expect(noWildcard.resolveFor('US')).toBeNull();
  });

  it('lists every registered key in priority order', () => {
    expect(registry.keys()).toEqual(['IYZICO', 'PAYTR', 'STRIPE']);
  });
});
