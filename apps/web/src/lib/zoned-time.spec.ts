import { createZonedFormatters, isValidTimeZone, resolveTimeZone, zonedIsoString } from './zoned-time';

// 2026-10-01T22:30:00Z is 01:30 on 2 October in Istanbul (UTC+3), 18:30 on 1 October in New York (EDT, UTC-4).
const INSTANT = '2026-10-01T22:30:00.000Z';

describe('zoned-time', () => {
  it('validates IANA zone names', () => {
    expect(isValidTimeZone('Europe/Istanbul')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('resolves the first valid candidate', () => {
    expect(resolveTimeZone(null, 'Not/AZone', 'Asia/Tokyo', 'UTC')).toBe('Asia/Tokyo');
    expect(resolveTimeZone(undefined, null)).toBeUndefined();
  });

  it('formats the clock time of the zone, not of the runtime', () => {
    expect(createZonedFormatters('en-GB', 'Europe/Istanbul').time(INSTANT)).toBe('01:30');
    expect(createZonedFormatters('en-GB', 'America/New_York').time(INSTANT)).toBe('18:30');
  });

  it('groups by the calendar day of the zone', () => {
    expect(createZonedFormatters('en', 'Europe/Istanbul').dayKey(INSTANT)).toBe('2026-10-02');
    expect(createZonedFormatters('en', 'America/New_York').dayKey(INSTANT)).toBe('2026-10-01');
  });

  it('formats the day and date-time in the zone and the locale', () => {
    const f = createZonedFormatters('en-US', 'America/New_York');
    expect(f.day(INSTANT)).toContain('Oct');
    expect(f.day(INSTANT)).toContain('1');
    expect(f.dateTime(INSTANT)).toContain('6:30');
    const tr = createZonedFormatters('tr', 'Europe/Istanbul');
    expect(tr.day(INSTANT)).toContain('Eki');
  });

  it('exposes a short zone name', () => {
    expect(createZonedFormatters('en-US', 'America/New_York').zoneName(INSTANT)).toBe('EDT');
    expect(createZonedFormatters('en-US', 'Europe/Istanbul').zoneName(INSTANT)).toMatch(/3/);
  });

  it('falls back to the runtime zone for an invalid zone instead of throwing', () => {
    expect(() => createZonedFormatters('en', 'Not/AZone').time(INSTANT)).not.toThrow();
  });

  it('builds an ISO timestamp with the offset of that instant (summer and winter)', () => {
    expect(zonedIsoString(INSTANT, 'Europe/Istanbul')).toBe('2026-10-02T01:30:00+03:00');
    expect(zonedIsoString(INSTANT, 'America/New_York')).toBe('2026-10-01T18:30:00-04:00');
    expect(zonedIsoString('2026-01-15T12:00:00.000Z', 'America/New_York')).toBe('2026-01-15T07:00:00-05:00');
    expect(zonedIsoString('2026-01-15T12:00:00.000Z', 'Asia/Kolkata')).toBe('2026-01-15T17:30:00+05:30');
  });

  it('uses a UTC instant when the zone is missing or invalid', () => {
    expect(zonedIsoString(INSTANT, null)).toBe('2026-10-01T22:30:00Z');
    expect(zonedIsoString(INSTANT, 'Not/AZone')).toBe('2026-10-01T22:30:00Z');
  });
});
