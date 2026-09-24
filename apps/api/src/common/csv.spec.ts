import { toCsv } from './csv';

describe('toCsv', () => {
  it('prefixes a UTF-8 BOM', () => {
    expect(toCsv(['A'], [['x']])[0]).toBe('﻿');
  });

  it('joins fields with a semicolon and rows with CRLF', () => {
    const csv = toCsv(['A', 'B'], [
      [1, 2],
      [3, 4],
    ]);
    expect(csv).toBe('﻿A;B\r\n1;2\r\n3;4\r\n');
  });

  it('quotes fields containing the separator, quotes or newlines', () => {
    const csv = toCsv(['Ad'], [['Ayşe; Yılmaz'], ['15" ekran'], ['satır\nsonu']]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('"Ayşe; Yılmaz"');
    expect(lines[2]).toBe('"15"" ekran"');
    expect(lines[3]).toBe('"satır\nsonu"');
  });

  it('renders null and undefined as empty fields', () => {
    expect(toCsv(['A', 'B'], [[null, undefined]])).toBe('﻿A;B\r\n;\r\n');
  });

  it('leaves plain Turkish characters unescaped', () => {
    const csv = toCsv(['Başlık'], [['Doluluk oranı']]);
    expect(csv).toContain('Doluluk oranı');
  });
});
