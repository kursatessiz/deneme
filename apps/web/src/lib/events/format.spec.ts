import { createZonedFormatters } from '@/lib/zoned-time';
import { formatSpan } from './format';

const f = createZonedFormatters('en-GB', 'Europe/Istanbul');

describe('formatSpan', () => {
  it('drops the date of the end when it is the same day in the zone', () => {
    const out = formatSpan(f, '2026-10-10T07:00:00.000Z', '2026-10-10T10:00:00.000Z');
    expect(out).toContain('10:00 - 13:00');
  });

  it('keeps both dates across days (a late evening end rolls over in the zone)', () => {
    const out = formatSpan(f, '2026-10-10T20:00:00.000Z', '2026-10-10T22:00:00.000Z');
    expect(out.match(/\d{2}:\d{2}/g)).toEqual(['23:00', '01:00']);
    expect(out).toContain(' - ');
    expect(out.split(' - ')[1].length).toBeGreaterThan(5);
  });

  it('shows only the start without an end', () => {
    expect(formatSpan(f, '2026-10-10T07:00:00.000Z', null)).not.toContain(' - ');
  });
});

import { summarize } from './format';

describe('summarize', () => {
  it('collapses whitespace and clips long text', () => {
    expect(summarize('  one\n two   three ')).toBe('one two three');
    expect(summarize('a'.repeat(200), 50)).toHaveLength(50);
    expect(summarize(null)).toBe('');
  });
});
