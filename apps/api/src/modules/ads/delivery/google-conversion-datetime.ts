/**
 * Formats a UTC instant as Google Ads' required
 * "yyyy-MM-dd HH:mm:ss+HH:mm" conversion_date_time, in the given IANA
 * timezone (the tenant's Studio.timezone).
 */
export function formatGoogleConversionDateTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'longOffset',
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const offsetRaw = get('timeZoneName'); // "GMT+03:00" or "GMT" for UTC
  const offset = offsetRaw === 'GMT' ? '+00:00' : offsetRaw.replace('GMT', '');
  // Midnight can format the hour as "24"; Google expects 00-23.
  const hour = get('hour') === '24' ? '00' : get('hour');

  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}${offset}`;
}
