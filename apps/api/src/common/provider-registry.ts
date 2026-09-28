/**
 * Generic country-aware provider registry: one interface per capability
 * (payments, SMS, ...), a priority list of adapters per country, and an
 * optional per-tenant override. See docs/BUYUME_VE_GLOBAL_MIMARI.md section
 * 2.2. Every concrete registry (PaymentProviderRegistry, the message
 * channel adapters) is built on top of this rather than re-implementing its
 * own country/override lookup.
 */
export interface ProviderCatalogEntry<TAdapter> {
  /** Stable key the tenant override and the country priority list refer to (e.g. 'STRIPE', 'NETGSM'). */
  key: string;
  adapter: TAdapter;
  /**
   * ISO 3166-1 alpha-2 country codes this adapter is the priority pick for,
   * checked in the order given. `'*'` matches any country not covered by a
   * more specific entry (the global default).
   */
  countries: readonly string[];
}

export class ProviderRegistry<TAdapter> {
  constructor(private readonly entries: readonly ProviderCatalogEntry<TAdapter>[]) {}

  /**
   * Resolves the adapter to use: a tenant override wins outright (if it
   * names a known key), otherwise the first entry whose `countries` lists
   * the given country, otherwise the first `'*'` (global default) entry.
   * Returns null only if the registry has no matching or wildcard entry.
   */
  resolveFor(countryCode: string | null | undefined, tenantOverrideKey?: string | null): TAdapter | null {
    if (tenantOverrideKey) {
      const overridden = this.byKey(tenantOverrideKey);
      if (overridden) return overridden;
    }
    const cc = (countryCode ?? '').toUpperCase();
    const byCountry = this.entries.find((e) => e.countries.includes(cc));
    if (byCountry) return byCountry.adapter;
    const wildcard = this.entries.find((e) => e.countries.includes('*'));
    return wildcard?.adapter ?? null;
  }

  byKey(key: string): TAdapter | null {
    return this.entries.find((e) => e.key.toUpperCase() === key.toUpperCase())?.adapter ?? null;
  }

  /** Every registered key, in priority order, for admin/debug listings. */
  keys(): string[] {
    return this.entries.map((e) => e.key);
  }
}
