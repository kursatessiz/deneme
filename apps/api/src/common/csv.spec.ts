import { csvCell, toCsv } from './csv';

describe('csv', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+905321112233')).toBe("'+905321112233");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('quotes separators, quotes and new lines', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell(null)).toBe('');
  });

  it('writes a BOM, semicolons and CRLF', () => {
    expect(toCsv(['Ad', 'Tutar'], [['Ayşe', '12,50']])).toBe('﻿Ad;Tutar\r\nAyşe;12,50\r\n');
  });
});
