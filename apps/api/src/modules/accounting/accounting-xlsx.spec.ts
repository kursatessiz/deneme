import {
  BASE_MESSAGES,
  BUNDLED_MESSAGES,
  EXPENSE_JOURNAL_COLUMNS,
  SALES_JOURNAL_COLUMNS,
  SUMMARY_COLUMNS,
  buildAccountingSummary,
  buildExpenseJournal,
  buildSalesJournal,
  createTranslator,
} from '@platform/shared';
import type { AccountingColumn, AccountingPaymentSource } from '@platform/shared';
import { buildAccountingWorkbook } from './accounting-xlsx';
import { excelSerialDate } from './xlsx/xlsx-primitives';
import { parseSheetCells, readZipText } from './xlsx/xlsx-test-reader';
import type { ParsedCell } from './xlsx/xlsx-test-reader';
import { buildXlsx } from './xlsx/xlsx-writer';

const RANGE = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59Z') };
const t = createTranslator({ locale: 'en', messages: BUNDLED_MESSAGES.en, fallback: BASE_MESSAGES });

function payment(overrides: Partial<AccountingPaymentSource>): AccountingPaymentSource {
  return {
    paymentId: 'p1',
    branchId: null,
    paidAt: new Date('2026-09-10T09:00:00Z'),
    receiptNumber: 'R-1',
    invoiceNumber: null,
    customerName: 'Guest',
    description: 'Ticket',
    currency: 'EUR',
    gross: '120.00',
    paymentMethod: 'CASH',
    providerReference: null,
    taxComponents: [{ taxRate: '20', gross: '120.00' }],
    refunds: [],
    ...overrides,
  };
}

const sales = buildSalesJournal(
  [
    payment({ paymentId: 'e1', customerName: '=HYPERLINK("http://x","y")', description: '+cmd' }),
    payment({ paymentId: 'e2', receiptNumber: 'R-2', gross: '40.00', refunds: [{ at: new Date('2026-09-12T10:00:00Z'), amount: '40.00' }] }),
    payment({ paymentId: 'j1', receiptNumber: 'J-1', currency: 'JPY', gross: '3000', taxComponents: [] }),
  ],
  RANGE,
);

interface Parsed {
  files: Map<string, string>;
  sheetNames: string[];
  sheet: (name: string) => Map<number, ParsedCell[]>;
  sheetXml: (name: string) => string;
  /** cellXfs entries of styles.xml as raw attribute strings. */
  xfs: string[];
  numFmts: Map<number, string>;
}

function parse(buffer: Buffer): Parsed {
  const files = readZipText(buffer);
  const workbook = files.get('xl/workbook.xml') as string;
  const sheetNames = [...workbook.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
  const sheetXml = (name: string): string => {
    const index = sheetNames.indexOf(name);
    expect(index).toBeGreaterThanOrEqual(0);
    return files.get(`xl/worksheets/sheet${index + 1}.xml`) as string;
  };
  const styles = files.get('xl/styles.xml') as string;
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  return {
    files,
    sheetNames,
    sheetXml,
    sheet: (name) => parseSheetCells(sheetXml(name)),
    xfs: [...cellXfs.matchAll(/<xf ([^>]*)\/>/g)].map((m) => m[1]),
    numFmts: new Map([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), m[2]])),
  };
}

const isBold = (p: Parsed, cell: ParsedCell): boolean => p.xfs[cell.s].includes('fontId="1"');
/** Number format code of a cell (built-in ids resolved). */
function formatOf(p: Parsed, cell: ParsedCell): string | undefined {
  const id = Number(/numFmtId="(\d+)"/.exec(p.xfs[cell.s])?.[1] ?? 0);
  const builtin: Record<number, string> = { 1: '0', 3: '#,##0', 4: '#,##0.00' };
  return builtin[id] ?? p.numFmts.get(id);
}

const journal = (): Buffer => buildAccountingWorkbook({ columns: SALES_JOURNAL_COLUMNS, rows: sales, t, fallbackCurrency: 'EUR', totals: true });

describe('buildAccountingWorkbook', () => {
  it('contains every required part with matching content types and relationships', () => {
    const p = parse(journal());
    for (const name of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
      'docProps/core.xml',
      'docProps/app.xml',
    ]) {
      expect(p.files.has(name)).toBe(true);
    }
    const types = p.files.get('[Content_Types].xml') as string;
    expect(types).toContain('PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"');
    expect(types).toContain('PartName="/xl/worksheets/sheet2.xml"');
    const rels = p.files.get('xl/_rels/workbook.xml.rels') as string;
    expect(rels).toContain('Id="rId1"');
    expect(rels).toContain('Id="rId2"');
    expect(rels).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"');
    expect(p.files.get('xl/workbook.xml')).toContain('r:id="rId2"');
  });

  it('writes one sheet per currency with a bold, frozen, filtered header in the requested language', () => {
    const p = parse(journal());
    expect(p.sheetNames).toEqual(['EUR', 'JPY']);
    const eur = p.sheet('EUR');
    const header = eur.get(1) as ParsedCell[];
    expect(header).toHaveLength(SALES_JOURNAL_COLUMNS.length);
    expect(header[0].value).toBe('Date');
    expect(header[9].value).toBe('Gross');
    expect(header.every((c) => c.t === 'inlineStr' && isBold(p, c))).toBe(true);

    const xml = p.sheetXml('EUR');
    expect(xml).toContain('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
    const dataRows = sales.filter((r) => r.currency === 'EUR').length;
    expect(xml).toContain(`<autoFilter ref="A1:${String.fromCharCode(64 + SALES_JOURNAL_COLUMNS.length)}${1 + dataRows}"/>`);
    const widths = [...xml.matchAll(/<col min="(\d+)" max="\d+" width="([\d.]+)" customWidth="1"\/>/g)].map((m) => Number(m[2]));
    expect(widths).toHaveLength(SALES_JOURNAL_COLUMNS.length);
    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(10);
      expect(width).toBeLessThanOrEqual(50);
    }
    // Currencies never share a sheet: the currency column of every JPY data row says JPY.
    const jpy = p.sheet('JPY');
    expect(jpy.get(2)?.[10].value).toBe('JPY');
  });

  it('types cells as numbers, inline strings and dates and never writes a formula, even for text starting with "="', () => {
    const p = parse(journal());
    for (const [name, xml] of p.files) {
      if (name.endsWith('.xml') || name.endsWith('.rels')) expect(xml).not.toMatch(/<f[\s>/]/);
    }
    const eur = p.sheet('EUR');
    const first = eur.get(2) as ParsedCell[];
    expect(first[0].t).toBe('n');
    expect(Number(first[0].value)).toBeCloseTo(excelSerialDate(new Date('2026-09-10T09:00:00Z')), 6);
    expect(formatOf(p, first[0])).toBe('yyyy-mm-dd hh:mm:ss');
    expect(first[4].t).toBe('inlineStr');
    expect(first[4].value).toBe('=HYPERLINK(&quot;http://x&quot;,&quot;y&quot;)');
    expect(first[5]).toMatchObject({ t: 'inlineStr', value: '+cmd' });
    expect(first[9]).toMatchObject({ t: 'n', value: '120' });
    expect(formatOf(p, first[9])).toBe('#,##0.00');
    expect(first[7].t).toBe('n'); // tax rate
    const jpyFirst = p.sheet('JPY').get(2) as ParsedCell[];
    expect(jpyFirst[9]).toMatchObject({ t: 'n', value: '3000' });
    expect(formatOf(p, jpyFirst[9])).toBe('#,##0');

    for (const name of p.sheetNames) {
      for (const cells of p.sheet(name).values()) {
        for (const cell of cells) {
          expect(cell.hasFormula).toBe(false);
          expect(['n', 'inlineStr']).toContain(cell.t);
        }
      }
    }
  });

  it('ends a journal sheet with a bold totals row (refunds netted in) after a blank row, outside the filter range', () => {
    const p = parse(journal());
    const eur = p.sheet('EUR');
    const dataRows = sales.filter((r) => r.currency === 'EUR').length;
    expect(eur.has(dataRows + 2)).toBe(false);
    const totals = eur.get(dataRows + 3) as ParsedCell[];
    expect(totals[0].value).toBe('Total');
    expect(totals.every((c) => isBold(p, c))).toBe(true);
    const gross = totals.find((c) => c.ref === `J${dataRows + 3}`) as ParsedCell;
    expect(gross).toMatchObject({ t: 'n', value: '120' }); // 120 + 40 - 40
    const refundIndex = sales.filter((r) => r.currency === 'EUR').findIndex((r) => r.entryType === 'REFUND');
    expect((eur.get(2 + refundIndex) as ParsedCell[])[9].value).toBe('-40');
  });

  it('keeps an empty export as one header-only sheet and writes the summary without totals', () => {
    const empty = parse(buildAccountingWorkbook({ columns: EXPENSE_JOURNAL_COLUMNS, rows: buildExpenseJournal([], 'GBP', RANGE), t, fallbackCurrency: 'GBP', totals: true }));
    expect(empty.sheetNames).toEqual(['GBP']);
    expect([...empty.sheet('GBP').keys()]).toEqual([1]);
    expect(empty.sheetXml('GBP')).toContain(`<autoFilter ref="A1:${String.fromCharCode(64 + EXPENSE_JOURNAL_COLUMNS.length)}1"/>`);

    const summaryRows = buildAccountingSummary(sales, []);
    const summary = parse(
      buildAccountingWorkbook({ columns: SUMMARY_COLUMNS as readonly AccountingColumn<{ currency: string }>[], rows: summaryRows, t, fallbackCurrency: 'EUR', totals: false }),
    );
    const eur = summary.sheet('EUR');
    expect(eur.size).toBe(1 + summaryRows.filter((r) => r.currency === 'EUR').length);
    expect((eur.get(2) as ParsedCell[])[3].t).toBe('n'); // count
  });
});

describe('buildXlsx', () => {
  it('sanitises and de-duplicates sheet names and escapes text', () => {
    const p = parse(
      buildXlsx({
        sheets: [
          { name: 'A/B', rows: [[{ type: 'string', value: 'x & <y>\u0000' }]] },
          { name: 'a_b', rows: [[{ type: 'string', value: 'plain' }]] },
          { name: "It's", rows: [] },
        ],
      }),
    );
    expect(p.sheetNames).toEqual(['A_B', 'a_b (2)', 'It&apos;s']);
    expect(p.sheet('A_B').get(1)?.[0].value).toBe('x &amp; &lt;y&gt;');
  });

  it('rejects non-finite numbers and empty workbooks', () => {
    expect(() => buildXlsx({ sheets: [{ name: 'S', rows: [[{ type: 'number', value: Number.NaN }]] }] })).toThrow(RangeError);
    expect(() => buildXlsx({ sheets: [] })).toThrow(RangeError);
  });
});
