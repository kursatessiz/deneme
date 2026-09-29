import { crc32, buildZip, cellRef, columnLetters, escapeXml, excelSerialDate, sanitizeSheetName, stripInvalidXmlChars } from './xlsx-primitives';
import { readZip } from './xlsx-test-reader';

describe('crc32', () => {
  it('matches the known vectors', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.from('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('escapeXml', () => {
  it('escapes the five XML characters and CR', () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe('a &amp; b &lt; c &gt; d &quot; e &apos; f');
    expect(escapeXml('a\r\nb')).toBe('a&#13;\nb');
  });

  it('strips characters that are invalid in XML 1.0 but keeps tab, LF, CR and astral characters', () => {
    expect(stripInvalidXmlChars('a\u0000b\u0008c\u000Bd\u000Ce\u001Ff￾g￿h')).toBe('abcdefgh');
    expect(stripInvalidXmlChars('t\tn\nr\r')).toBe('t\tn\nr\r');
    expect(stripInvalidXmlChars('ok \u{1F600} \uD800 lone \uDC00')).toBe('ok \u{1F600}  lone ');
  });
});

describe('cell references', () => {
  it('converts column numbers to letters', () => {
    expect(columnLetters(1)).toBe('A');
    expect(columnLetters(26)).toBe('Z');
    expect(columnLetters(27)).toBe('AA');
    expect(columnLetters(702)).toBe('ZZ');
    expect(columnLetters(703)).toBe('AAA');
    expect(columnLetters(16384)).toBe('XFD');
    expect(() => columnLetters(0)).toThrow(RangeError);
    expect(() => columnLetters(16385)).toThrow(RangeError);
  });

  it('builds A1 references', () => {
    expect(cellRef(1, 1)).toBe('A1');
    expect(cellRef(11, 20)).toBe('K20');
    expect(() => cellRef(1, 0)).toThrow(RangeError);
  });
});

describe('excelSerialDate', () => {
  it('uses the 1900 system in UTC', () => {
    expect(excelSerialDate(new Date('1900-03-01T00:00:00Z'))).toBe(61);
    expect(excelSerialDate(new Date('1970-01-01T00:00:00Z'))).toBe(25569);
    expect(excelSerialDate(new Date('2026-09-29T00:00:00Z'))).toBe(46294);
    expect(excelSerialDate(new Date('2026-09-29T12:00:00Z'))).toBe(46294.5);
  });

  it('rejects invalid dates', () => {
    expect(() => excelSerialDate(new Date('nope'))).toThrow(RangeError);
  });
});

describe('sanitizeSheetName', () => {
  it('replaces forbidden characters, limits to 31 characters and never returns an empty name', () => {
    expect(sanitizeSheetName('EUR')).toBe('EUR');
    expect(sanitizeSheetName('a[b]c:d*e?f/g\\h')).toBe('a_b_c_d_e_f_g_h');
    expect(sanitizeSheetName('x'.repeat(40))).toHaveLength(31);
    expect(sanitizeSheetName("'quoted'")).toBe('quoted');
    expect(sanitizeSheetName('')).toBe('_');
    expect(sanitizeSheetName("''")).toBe('_');
  });
});

describe('buildZip', () => {
  it('produces an archive a reader can parse back, with UTF-8 names', () => {
    const entries = [
      { name: 'a.txt', data: Buffer.from('hello hello hello hello') },
      { name: 'dir/ü.txt', data: Buffer.alloc(0) },
      { name: 'big.bin', data: Buffer.alloc(100_000, 7) },
    ];
    const files = readZip(buildZip(entries));
    expect([...files.keys()]).toEqual(['a.txt', 'dir/ü.txt', 'big.bin']);
    for (const entry of entries) expect(files.get(entry.name)?.equals(entry.data)).toBe(true);
  });
});
