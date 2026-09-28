import { formatGoogleConversionDateTime } from './google-conversion-datetime';

describe('formatGoogleConversionDateTime', () => {
  it('formats a UTC instant in Europe/Istanbul (+03:00, no DST)', () => {
    expect(formatGoogleConversionDateTime(new Date('2026-09-28T10:15:00Z'), 'Europe/Istanbul')).toBe('2026-09-28 13:15:00+03:00');
  });

  it('formats midnight UTC without emitting hour 24', () => {
    expect(formatGoogleConversionDateTime(new Date('2026-01-01T00:00:00Z'), 'UTC')).toBe('2026-01-01 00:00:00+00:00');
  });

  it('formats a negative offset (America/New_York)', () => {
    // 2026-01-15 is outside DST, EST is UTC-05:00.
    expect(formatGoogleConversionDateTime(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe('2026-01-15 07:00:00-05:00');
  });
});
