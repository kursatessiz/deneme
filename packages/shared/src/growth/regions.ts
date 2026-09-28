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

const EU_EEA = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV',
  'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'CH',
]);

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

export function formatMoney(money: Money, locale: string): string {
  const value = Number(money.amount);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }).format(value);
  } catch {
    return `${money.amount} ${money.currency}`;
  }
}
