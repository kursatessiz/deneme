/**
 * Locale-aware date/number formatting built on Intl, replacing hardcoded
 * 'tr-TR' formatting calls. Each helper takes the active locale explicitly
 * so it stays a plain function (usable outside components, e.g. in widget
 * code) and is trivially testable; useFormatters() below binds it to the
 * current app locale for use inside components.
 */

export type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Falls back to the base locale ('tr') if Intl rejects an unknown/region tag. */
function safeFormat<T>(locale: string, run: (loc: string) => T, fallback: () => T): T {
  try {
    return run(locale);
  } catch {
    try {
      return run('tr');
    } catch {
      return fallback();
    }
  }
}

export function formatDate(value: DateInput, locale: string, options?: Intl.DateTimeFormatOptions): string {
  const date = toDate(value);
  return safeFormat(
    locale,
    (loc) => new Intl.DateTimeFormat(loc, options).format(date),
    () => date.toISOString().slice(0, 10),
  );
}

export function formatTime(value: DateInput, locale: string, options?: Intl.DateTimeFormatOptions): string {
  return formatDate(value, locale, { hour: '2-digit', minute: '2-digit', ...options });
}

export function formatDateTime(value: DateInput, locale: string, options?: Intl.DateTimeFormatOptions): string {
  return formatDate(value, locale, { dateStyle: 'medium', timeStyle: 'short', ...options });
}

export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return safeFormat(
    locale,
    (loc) => new Intl.NumberFormat(loc, options).format(value),
    () => String(value),
  );
}

/** Currency amount in the active locale; the ISO 4217 code always comes from the tenant, never a default. */
export function formatCurrency(value: number, locale: string, currency: string, options?: Intl.NumberFormatOptions): string {
  return formatNumber(value, locale, { style: 'currency', currency, ...options });
}
