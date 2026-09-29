import { ValueType, Workbook } from 'exceljs';
import type { Worksheet } from 'exceljs';
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

async function readBack(buffer: Buffer): Promise<Workbook> {
  const workbook = new Workbook();
  // exceljs types its input as an ArrayBuffer-like "Buffer"; hand it the exact bytes.
  await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  return workbook;
}

function everyCell(sheet: Worksheet, visit: (type: ValueType, formula: string | undefined, value: unknown) => void): void {
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => visit(cell.type, cell.formula, cell.value));
  });
}

describe('buildAccountingWorkbook', () => {
  it('writes one sheet per currency with a bold, frozen, filtered header in the requested language', async () => {
    const workbook = await readBack(await buildAccountingWorkbook({ columns: SALES_JOURNAL_COLUMNS, rows: sales, t, fallbackCurrency: 'EUR', totals: true }));
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['EUR', 'JPY']);
    const eur = workbook.getWorksheet('EUR') as Worksheet;
    const header = eur.getRow(1);
    expect(header.getCell(1).value).toBe('Date');
    expect(header.getCell(10).value).toBe('Gross');
    expect(header.getCell(1).font?.bold).toBe(true);
    expect(eur.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(eur.autoFilter).toBeTruthy();
    for (let c = 1; c <= SALES_JOURNAL_COLUMNS.length; c++) {
      const width = eur.getColumn(c).width ?? 0;
      expect(width).toBeGreaterThanOrEqual(10);
      expect(width).toBeLessThanOrEqual(50);
    }
    // Currencies never share a sheet.
    const jpy = workbook.getWorksheet('JPY') as Worksheet;
    for (let r = 2; r <= jpy.rowCount; r++) {
      const cur = jpy.getRow(r).getCell(11).value;
      if (cur !== null) expect(cur).toBe('JPY');
    }
  });

  it('types cells as numbers, strings and dates and never writes a formula, even for text starting with "="', async () => {
    const workbook = await readBack(await buildAccountingWorkbook({ columns: SALES_JOURNAL_COLUMNS, rows: sales, t, fallbackCurrency: 'EUR', totals: true }));
    const eur = workbook.getWorksheet('EUR') as Worksheet;
    const first = eur.getRow(2);
    expect(first.getCell(1).type).toBe(ValueType.Date);
    expect(first.getCell(1).value).toEqual(new Date('2026-09-10T09:00:00.000Z'));
    expect(first.getCell(5).type).toBe(ValueType.String);
    expect(first.getCell(5).value).toBe('=HYPERLINK("http://x","y")');
    expect(first.getCell(6).value).toBe('+cmd');
    expect(first.getCell(10).type).toBe(ValueType.Number);
    expect(first.getCell(10).value).toBe(120);
    expect(first.getCell(10).numFmt).toBe('#,##0.00');
    expect(first.getCell(8).type).toBe(ValueType.Number); // tax rate
    const jpy = workbook.getWorksheet('JPY') as Worksheet;
    expect(jpy.getRow(2).getCell(10).value).toBe(3000);
    expect(jpy.getRow(2).getCell(10).numFmt).toBe('#,##0');

    for (const sheet of workbook.worksheets) {
      everyCell(sheet, (type, formula) => {
        expect(type).not.toBe(ValueType.Formula);
        expect(formula).toBeUndefined();
        expect([ValueType.Number, ValueType.String, ValueType.Date]).toContain(type);
      });
    }
  });

  it('ends a journal sheet with a bold totals row (refunds netted in) outside the filter range', async () => {
    const workbook = await readBack(await buildAccountingWorkbook({ columns: SALES_JOURNAL_COLUMNS, rows: sales, t, fallbackCurrency: 'EUR', totals: true }));
    const eur = workbook.getWorksheet('EUR') as Worksheet;
    const dataRows = sales.filter((r) => r.currency === 'EUR').length;
    expect(eur.getRow(dataRows + 2).getCell(1).value).toBeNull();
    const totals = eur.getRow(dataRows + 3);
    expect(totals.getCell(1).value).toBe('Total');
    expect(totals.getCell(1).font?.bold).toBe(true);
    expect(totals.getCell(10).value).toBe(120); // 120 + 40 - 40
    expect(totals.getCell(10).type).toBe(ValueType.Number);
    const refund = eur.getRow(2 + sales.filter((r) => r.currency === 'EUR').findIndex((r) => r.entryType === 'REFUND'));
    expect(refund.getCell(10).value).toBe(-40);
  });

  it('keeps an empty export as one header-only sheet and writes the summary without totals', async () => {
    const empty = await readBack(await buildAccountingWorkbook({ columns: EXPENSE_JOURNAL_COLUMNS, rows: buildExpenseJournal([], 'GBP', RANGE), t, fallbackCurrency: 'GBP', totals: true }));
    expect(empty.worksheets.map((s) => s.name)).toEqual(['GBP']);
    expect((empty.getWorksheet('GBP') as Worksheet).rowCount).toBe(1);

    const summaryRows = buildAccountingSummary(sales, []);
    const summary = await readBack(
      await buildAccountingWorkbook({ columns: SUMMARY_COLUMNS as readonly AccountingColumn<{ currency: string }>[], rows: summaryRows, t, fallbackCurrency: 'EUR', totals: false }),
    );
    const eur = summary.getWorksheet('EUR') as Worksheet;
    expect(eur.rowCount).toBe(1 + summaryRows.filter((r) => r.currency === 'EUR').length);
    expect(eur.getRow(2).getCell(4).type).toBe(ValueType.Number); // count
  });
});
