import { z } from 'zod';

/**
 * Country, currency and compliance region. Nothing in the platform assumes
 * a country: a tenant (Studio) carries countryCode + currency + taxRegime,
 * a contact carries its own countryCode and timezone, and every commercial
 * message is checked against the recipient's compliance region.
 * See docs/BUYUME_VE_GLOBAL_MIMARI.md section 2.
 */

export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'Geçersiz ülke kodu');
export type CountryCode = z.infer<typeof CountryCodeSchema>;

export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'Geçersiz para birimi');
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

export const TAX_REGIMES = ['TR_KDV', 'EU_VAT', 'UK_VAT', 'US_SALES_TAX', 'NONE'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

/** Rule sets applied by the compliance module to consent, quiet hours and unsubscribe. */
export const COMPLIANCE_REGIONS = ['TR', 'EU', 'UK', 'US', 'CA', 'DEFAULT'] as const;
export type ComplianceRegion = (typeof COMPLIANCE_REGIONS)[number];

/**
 * Countries that fall under the EU compliance region: the 27 EU member
 * states, the EEA members Iceland, Liechtenstein and Norway, and
 * Switzerland (same consent practice). Data, not logic: the double opt-in
 * region list (MarketingSettings.doubleOptInRegions) refers to it through
 * the region code `EU`.
 */
export const EU_EEA_COUNTRIES: readonly string[] = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV',
  'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'CH',
];
const EU_EEA = new Set(EU_EEA_COUNTRIES);

export function complianceRegionOf(countryCode: string | null | undefined): ComplianceRegion {
  if (!countryCode) return 'DEFAULT';
  const code = countryCode.toUpperCase();
  if (code === 'TR') return 'TR';
  if (code === 'GB') return 'UK';
  if (code === 'US') return 'US';
  if (code === 'CA') return 'CA';
  if (EU_EEA.has(code)) return 'EU';
  return 'DEFAULT';
}

export function defaultTaxRegimeOf(countryCode: string): TaxRegime {
  const region = complianceRegionOf(countryCode);
  if (region === 'TR') return 'TR_KDV';
  if (region === 'EU') return 'EU_VAT';
  if (region === 'UK') return 'UK_VAT';
  if (region === 'US') return 'US_SALES_TAX';
  return 'NONE';
}

/** Region settings every tenant carries (PUT /studios/:studioId/region). */
export const StudioRegionSchema = z
  .object({
    countryCode: CountryCodeSchema,
    currency: CurrencyCodeSchema,
    timezone: z.string().min(1).max(60),
    taxRegime: z.enum(TAX_REGIMES),
    /** Whether package prices are entered tax-inclusive. */
    pricesIncludeTax: z.boolean(),
  })
  .strict();
export type StudioRegion = z.infer<typeof StudioRegionSchema>;

/** A monetary amount. `amount` is a decimal string to avoid float rounding. */
export const MoneySchema = z
  .object({
    amount: z.string().regex(/^-?\d{1,12}(\.\d{1,4})?$/, 'Geçersiz tutar'),
    currency: CurrencyCodeSchema,
  })
  .strict();
export type Money = z.infer<typeof MoneySchema>;

/** Defaults a new tenant's region settings derive from its countryCode (super-admin tenant creation). */
export interface CountryDefaults {
  currency: CurrencyCode;
  timezone: string;
  taxRegime: TaxRegime;
  defaultLocale: string;
}

/**
 * Small, explicit table of sane defaults per country. Not exhaustive: an
 * unknown country falls back to USD/UTC/NONE/en and the admin completes it.
 * See docs/BUYUME_VE_GLOBAL_MIMARI.md section 2.1.
 */
const COUNTRY_DEFAULTS: Record<string, CountryDefaults> = {
  TR: { currency: 'TRY', timezone: 'Europe/Istanbul', taxRegime: 'TR_KDV', defaultLocale: 'tr' },
  US: { currency: 'USD', timezone: 'America/New_York', taxRegime: 'US_SALES_TAX', defaultLocale: 'en' },
  CA: { currency: 'CAD', timezone: 'America/Toronto', taxRegime: 'NONE', defaultLocale: 'en' },
  GB: { currency: 'GBP', timezone: 'Europe/London', taxRegime: 'UK_VAT', defaultLocale: 'en' },
  DE: { currency: 'EUR', timezone: 'Europe/Berlin', taxRegime: 'EU_VAT', defaultLocale: 'de' },
  FR: { currency: 'EUR', timezone: 'Europe/Paris', taxRegime: 'EU_VAT', defaultLocale: 'fr' },
  ES: { currency: 'EUR', timezone: 'Europe/Madrid', taxRegime: 'EU_VAT', defaultLocale: 'es' },
  IT: { currency: 'EUR', timezone: 'Europe/Rome', taxRegime: 'EU_VAT', defaultLocale: 'it' },
  NL: { currency: 'EUR', timezone: 'Europe/Amsterdam', taxRegime: 'EU_VAT', defaultLocale: 'nl' },
  AE: { currency: 'AED', timezone: 'Asia/Dubai', taxRegime: 'NONE', defaultLocale: 'en' },
};

const FALLBACK_DEFAULTS: CountryDefaults = { currency: 'USD', timezone: 'UTC', taxRegime: 'NONE', defaultLocale: 'en' };

/** Looks up { currency, timezone, taxRegime, defaultLocale } for a country; unknown countries get the documented fallback. */
export function countryDefaultsOf(countryCode: string): CountryDefaults {
  return COUNTRY_DEFAULTS[countryCode.toUpperCase()] ?? FALLBACK_DEFAULTS;
}

export function formatMoney(money: Money, locale: string): string {
  const value = Number(money.amount);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }).format(value);
  } catch {
    return `${money.amount} ${money.currency}`;
  }
}

/**
 * ISO 4217 currencies whose minor unit is not 1/100. Payment providers take
 * amounts in minor units, so `amount * 100` would charge 100x too much in
 * JPY or 10x too little in KWD.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function currencyMinorUnitDigits(currency: string): 0 | 2 | 3 {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

/** Converts a major-unit amount (e.g. 12.5 EUR) to integer minor units (1250). */
export function toMinorUnits(amount: number | string, currency: string): number {
  const digits = currencyMinorUnitDigits(currency);
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) throw new Error(`Geçersiz tutar: ${String(amount)}`);
  // Round on the decimal string, not on a float product, to avoid 0.1 + 0.2 artefacts.
  return Math.round(Number(`${value.toFixed(digits)}e${digits}`));
}
