import { buildIcsCalendar, escapeIcsText } from './ics-builder';

describe('escapeIcsText', () => {
  it('escapes backslash, comma, semicolon and newlines', () => {
    expect(escapeIcsText('A, B; C\\D\nE')).toBe('A\\, B\\; C\\\\D\\nE');
  });
});

describe('buildIcsCalendar', () => {
  it('produces a valid VCALENDAR envelope with CRLF line endings', () => {
    const ics = buildIcsCalendar({
      calendarName: 'Rezervasyonlarim',
      productId: '-//platform//calendar//TR',
      events: [],
    });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0\r\n');
    expect(ics).toContain('X-WR-CALNAME:Rezervasyonlarim\r\n');
  });

  it('renders event fields with UTC date-times', () => {
    const ics = buildIcsCalendar({
      calendarName: 'Cal',
      productId: '-//p//',
      events: [
        {
          uid: 'booking-1@platform',
          summary: 'Pilates dersi',
          start: new Date(Date.UTC(2026, 9, 1, 9, 0, 0)),
          end: new Date(Date.UTC(2026, 9, 1, 10, 0, 0)),
          location: 'Merkez Subesi',
        },
      ],
    });
    expect(ics).toContain('UID:booking-1@platform\r\n');
    expect(ics).toContain('DTSTART:20261001T090000Z\r\n');
    expect(ics).toContain('DTEND:20261001T100000Z\r\n');
    expect(ics).toContain('SUMMARY:Pilates dersi\r\n');
    expect(ics).toContain('STATUS:CONFIRMED\r\n');
    expect(ics).toContain('LOCATION:Merkez Subesi\r\n');
  });

  it('marks cancelled bookings with STATUS:CANCELLED', () => {
    const ics = buildIcsCalendar({
      calendarName: 'Cal',
      productId: '-//p//',
      events: [
        {
          uid: 'booking-2@platform',
          summary: 'Yoga dersi',
          start: new Date(Date.UTC(2026, 9, 2, 9, 0, 0)),
          end: new Date(Date.UTC(2026, 9, 2, 10, 0, 0)),
          status: 'CANCELLED',
        },
      ],
    });
    expect(ics).toContain('STATUS:CANCELLED\r\n');
  });

  it('escapes commas and semicolons inside summary and location', () => {
    const ics = buildIcsCalendar({
      calendarName: 'Cal',
      productId: '-//p//',
      events: [
        {
          uid: 'booking-3@platform',
          summary: 'Ders, Ileri; Seviye',
          start: new Date(Date.UTC(2026, 9, 3, 9, 0, 0)),
          end: new Date(Date.UTC(2026, 9, 3, 10, 0, 0)),
          location: 'Sube A, Kat 2',
        },
      ],
    });
    expect(ics).toContain('SUMMARY:Ders\\, Ileri\\; Seviye\r\n');
    expect(ics).toContain('LOCATION:Sube A\\, Kat 2\r\n');
  });

  it('folds long lines at 75 octets with a leading space continuation', () => {
    const longSummary = 'A'.repeat(120);
    const ics = buildIcsCalendar({
      calendarName: 'Cal',
      productId: '-//p//',
      events: [
        {
          uid: 'booking-4@platform',
          summary: longSummary,
          start: new Date(Date.UTC(2026, 9, 4, 9, 0, 0)),
          end: new Date(Date.UTC(2026, 9, 4, 10, 0, 0)),
        },
      ],
    });
    const rawLines = ics.split('\r\n');
    for (const line of rawLines) {
      // Every physical line (content or continuation) must respect the fold limit.
      expect(line.length).toBeLessThanOrEqual(75);
    }
    // Continuation lines start with a single space.
    const summaryLineIndex = rawLines.findIndex((l) => l.startsWith('SUMMARY:'));
    expect(rawLines[summaryLineIndex + 1].startsWith(' ')).toBe(true);
    // Unfolded, the summary must still be intact.
    const unfolded = rawLines.reduce<string[]>((acc, line) => {
      if (line.startsWith(' ')) acc[acc.length - 1] += line.slice(1);
      else acc.push(line);
      return acc;
    }, []);
    const summaryLine = unfolded.find((l) => l.startsWith('SUMMARY:'));
    expect(summaryLine).toBe(`SUMMARY:${longSummary}`);
  });
});
