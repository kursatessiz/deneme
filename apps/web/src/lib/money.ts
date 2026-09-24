/**
 * Money is always a decimal string from the API (`"1234.56"`), never a
 * float: the API sums with `Prisma.Decimal` and returns text specifically
 * so nothing in this app re-adds or re-subtracts amounts in floating point.
 * `Number()` here is used only to hand the value to `Intl.NumberFormat` for
 * display -- never for arithmetic. If you need to add or compare amounts,
 * do it on the API side and read the result back as a string.
 */
const TRY_FORMATTER = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });

/** Formats an API decimal string (or number, for literal zero/placeholder values) as Turkish lira for display only. */
export function formatMoney(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return TRY_FORMATTER.format(0);
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return TRY_FORMATTER.format(0);
  return TRY_FORMATTER.format(value);
}

/**
 * Sums a list of API decimal strings exactly, using integer cents (BigInt)
 * instead of floating point, and returns the result as a decimal string.
 * The only place this app adds money amounts together on its own (e.g. a
 * client-side total row); anything that affects an actual transaction is
 * computed on the API with `Prisma.Decimal`.
 */
export function sumMoney(amounts: readonly (string | null | undefined)[]): string {
  let totalCents = 0n;
  for (const amount of amounts) {
    if (!amount) continue;
    const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
    if (!match) continue;
    const [, sign, whole, fraction = ''] = match;
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    totalCents += sign === '-' ? -cents : cents;
  }
  const negative = totalCents < 0n;
  const abs = negative ? -totalCents : totalCents;
  const wholePart = abs / 100n;
  const centsPart = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${wholePart}.${centsPart}`;
}

/** Formats a 0..1 ratio (e.g. occupancy, renewal rate) as a Turkish percentage string, e.g. "%42". */
export function formatPercent(ratio: number | null | undefined, fractionDigits = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '%0';
  return `%${(ratio * 100).toLocaleString('tr-TR', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}`;
}
