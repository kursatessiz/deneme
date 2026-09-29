import {
  AccountingExportQuerySchema,
  EXPENSE_JOURNAL_COLUMNS,
  SALES_JOURNAL_COLUMNS,
  SUMMARY_COLUMNS,
  accountingCsvCell,
  amountToMinor,
  buildAccountingJson,
  buildAccountingSummary,
  buildExpenseJournal,
  buildSalesJournal,
  formatTaxRate,
  minorToAmount,
  renderAccountingCsv,
  splitInclusiveTax,
} from './accounting';
import type { AccountingPaymentSource } from './accounting';
import { BASE_MESSAGES, BUNDLED_MESSAGES } from './i18n';
import { ALL_WEBHOOK_EVENTS, WEBHOOK_SAMPLE_DATA, webhookSamplePayload } from './open-platform';

const RANGE = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59Z') };

function payment(overrides: Partial<AccountingPaymentSource> = {}): AccountingPaymentSource {
  return {
    paymentId: 'p1',
    branchId: null,
    paidAt: new Date('2026-09-10T09:00:00Z'),
    receiptNumber: 'R-1',
    invoiceNumber: null,
    customerName: 'Ayse Yilmaz',
    description: '10 session package',
    currency: 'EUR',
    gross: '120.00',
    paymentMethod: 'CASH',
    providerReference: null,
    taxComponents: [{ taxRate: '20', gross: '120.00' }],
    refunds: [],
    ...overrides,
  };
}

describe('money helpers', () => {
  it('parses and formats with the currency minor units', () => {
    expect(amountToMinor('12.345', 'EUR')).toBe(1235n);
    expect(amountToMinor('-0.005', 'EUR')).toBe(-1n);
    expect(amountToMinor('300.4', 'JPY')).toBe(300n);
    expect(minorToAmount(1250n, 'EUR')).toBe('12.50');
    expect(minorToAmount(-5n, 'EUR')).toBe('-0.05');
    expect(minorToAmount(300n, 'JPY')).toBe('300');
    expect(minorToAmount(0n, 'EUR')).toBe('0.00');
    expect(() => amountToMinor('abc', 'EUR')).toThrow();
  });

  it('splits tax-inclusive amounts half-up and mirrors refunds', () => {
    expect(splitInclusiveTax(12000n, '20')).toEqual({ net: 10000n, tax: 2000n });
    // 10.00 at 8% -> net 9.26 (9.259...), tax 0.74
    expect(splitInclusiveTax(1000n, '8')).toEqual({ net: 926n, tax: 74n });
    expect(splitInclusiveTax(-1000n, '8')).toEqual({ net: -926n, tax: -74n });
    expect(splitInclusiveTax(1000n, '0')).toEqual({ net: 1000n, tax: 0n });
  });

  it('prints tax rates without trailing zeros', () => {
    expect(formatTaxRate('20.00')).toBe('20');
    expect(formatTaxRate('8.50')).toBe('8.5');
    expect(formatTaxRate('0')).toBe('0');
  });
});

describe('sales journal', () => {
  it('builds one line per tax rate and gross equals net plus tax', () => {
    const rows = buildSalesJournal(
      [
        payment({
          gross: '30.00',
          taxComponents: [
            { taxRate: '20', gross: '10.00' },
            { taxRate: '10', gross: '20.00' },
          ],
        }),
      ],
      RANGE,
    );
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + amountToMinor(r.gross, 'EUR'), 0n)).toBe(3000n);
    for (const r of rows) expect(amountToMinor(r.net, 'EUR') + amountToMinor(r.tax, 'EUR')).toBe(amountToMinor(r.gross, 'EUR'));
    expect(rows.map((r) => r.taxRate).sort()).toEqual(['10', '20']);
  });

  it('writes refunds as negative lines and keeps payments outside the range out', () => {
    const rows = buildSalesJournal(
      [
        payment({ refunds: [{ at: new Date('2026-09-12T10:00:00Z'), amount: '60.00' }] }),
        payment({ paymentId: 'p2', paidAt: new Date('2026-08-31T23:00:00Z'), refunds: [{ at: new Date('2026-09-02T10:00:00Z'), amount: '12.00' }] }),
      ],
      RANGE,
    );
    expect(rows.map((r) => [r.paymentId, r.entryType, r.gross])).toEqual([
      ['p2', 'REFUND', '-12.00'],
      ['p1', 'SALE', '120.00'],
      ['p1', 'REFUND', '-60.00'],
    ]);
    const refund = rows.find((r) => r.paymentId === 'p1' && r.entryType === 'REFUND');
    expect(refund).toMatchObject({ net: '-50.00', tax: '-10.00', taxRate: '20' });
  });

  it('allocates an uneven refund without losing a cent', () => {
    const rows = buildSalesJournal(
      [
        payment({
          gross: '0.03',
          taxComponents: [
            { taxRate: '20', gross: '0.01' },
            { taxRate: '10', gross: '0.01' },
            { taxRate: '0', gross: '0.01' },
          ],
        }),
      ],
      RANGE,
    );
    expect(rows.reduce((s, r) => s + amountToMinor(r.gross, 'EUR'), 0n)).toBe(3n);
  });

  it('treats a payment without tax components as untaxed and falls back to the invoice number', () => {
    const [row] = buildSalesJournal([payment({ taxComponents: [], receiptNumber: null, invoiceNumber: 'A2026000001' })], RANGE);
    expect(row).toMatchObject({ documentNumber: 'A2026000001', invoiceNumber: 'A2026000001', taxRate: '0', tax: '0.00', net: '120.00' });
  });

  it('keeps the 0-decimal currency amounts whole', () => {
    const [row] = buildSalesJournal([payment({ currency: 'JPY', gross: '1100', taxComponents: [{ taxRate: '10', gross: '1100' }] })], RANGE);
    expect(row).toMatchObject({ net: '1000', tax: '100', gross: '1100', currency: 'JPY' });
  });
});

describe('expenses journal and summary', () => {
  it('filters by range and formats amounts in the studio currency', () => {
    const rows = buildExpenseJournal(
      [
        { expenseId: 'e1', branchId: null, spentAt: new Date('2026-09-05T00:00:00Z'), category: 'Rent', note: null, amount: '500' },
        { expenseId: 'e2', branchId: 'b1', spentAt: new Date('2026-10-05T00:00:00Z'), category: 'Rent', note: null, amount: '500' },
      ],
      'EUR',
      RANGE,
    );
    expect(rows).toEqual([expect.objectContaining({ expenseId: 'e1', amount: '500.00', currency: 'EUR', description: '' })]);
  });

  it('groups by tax rate and payment method per currency and never mixes currencies', () => {
    const sales = buildSalesJournal(
      [
        payment({ paymentMethod: 'CASH', refunds: [{ at: new Date('2026-09-11T00:00:00Z'), amount: '60.00' }] }),
        payment({ paymentId: 'p2', paymentMethod: 'ONLINE_STRIPE', gross: '50.00', taxComponents: [{ taxRate: '20', gross: '50.00' }] }),
        payment({ paymentId: 'p3', currency: 'USD', gross: '10.00', taxComponents: [] }),
      ],
      RANGE,
    );
    const expenses = buildExpenseJournal([{ expenseId: 'e1', branchId: null, spentAt: new Date('2026-09-05T00:00:00Z'), category: 'Rent', note: null, amount: '40' }], 'EUR', RANGE);
    const summary = buildAccountingSummary(sales, expenses);
    const eur = summary.filter((r) => r.currency === 'EUR');
    const usd = summary.filter((r) => r.currency === 'USD');
    expect(eur.find((r) => r.section === 'taxRate' && r.key === '20')).toMatchObject({ gross: '110.00', net: '91.67', tax: '18.33' });
    expect(eur.find((r) => r.section === 'paymentMethod' && r.key === 'CASH')?.gross).toBe('60.00');
    expect(eur.find((r) => r.section === 'total' && r.key === 'sales')?.gross).toBe('110.00');
    expect(eur.find((r) => r.section === 'total' && r.key === 'expenses')?.gross).toBe('40.00');
    expect(eur.find((r) => r.section === 'total' && r.key === 'result')?.gross).toBe('70.00');
    expect(usd.find((r) => r.section === 'total' && r.key === 'sales')?.gross).toBe('10.00');
    expect(usd.find((r) => r.section === 'total' && r.key === 'result')?.gross).toBe('10.00');
    expect(usd.some((r) => r.gross === '110.00')).toBe(false);
  });
});

describe('CSV', () => {
  const t = (key: string) => (BUNDLED_MESSAGES.en[key] ?? key);

  it('prefixes formula cells with a single quote but leaves numeric columns alone', () => {
    expect(accountingCsvCell('=HYPERLINK("x")', ';')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(accountingCsvCell('+1 555', ';')).toBe("'+1 555");
    expect(accountingCsvCell('-cmd', ';')).toBe("'-cmd");
    expect(accountingCsvCell('@SUM(A1)', ';')).toBe("'@SUM(A1)");
    expect(accountingCsvCell('-12.50', ';', true)).toBe('-12.50');
    expect(accountingCsvCell('-12.5+A1', ';', true)).toBe("'-12.5+A1");
  });

  it('quotes delimiter, quotes and line breaks per RFC 4180', () => {
    expect(accountingCsvCell('a;b', ';')).toBe('"a;b"');
    expect(accountingCsvCell('a;b', ',')).toBe('a;b');
    expect(accountingCsvCell('a,b', ',')).toBe('"a,b"');
    expect(accountingCsvCell('say "hi"', ';')).toBe('"say ""hi"""');
    expect(accountingCsvCell('l1\nl2', ';')).toBe('"l1\nl2"');
    expect(accountingCsvCell(null, ';')).toBe('');
  });

  it('starts with a BOM, translates the header by locale and honours the delimiter', () => {
    const rows = buildSalesJournal([payment({ customerName: '=1+1', description: 'a;b' })], RANGE);
    const csv = renderAccountingCsv(SALES_JOURNAL_COLUMNS, rows, t, 'semicolon');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, line] = csv.slice(1).split('\r\n');
    expect(header.startsWith('Date;Entry type;Document number')).toBe(true);
    expect(line).toContain("'=1+1");
    expect(line).toContain('"a;b"');
    const comma = renderAccountingCsv(SALES_JOURNAL_COLUMNS, rows, (k) => BASE_MESSAGES[k as keyof typeof BASE_MESSAGES] ?? k, 'comma');
    expect(comma.slice(1).startsWith('Tarih,Kayıt türü,Belge no')).toBe(true);
    expect(comma.endsWith('\r\n')).toBe(true);
  });

  it('writes refunds as plain negative numbers', () => {
    const rows = buildSalesJournal([payment({ refunds: [{ at: new Date('2026-09-12T10:00:00Z'), amount: '60.00' }] })], RANGE);
    const csv = renderAccountingCsv(SALES_JOURNAL_COLUMNS, rows, t);
    expect(csv).toContain(';-50.00;20;-10.00;-60.00;');
  });

  it('renders the expense and summary columns', () => {
    const exp = buildExpenseJournal([{ expenseId: 'e1', branchId: null, spentAt: new Date('2026-09-05T00:00:00Z'), category: 'Rent', note: 'note', amount: '40' }], 'EUR', RANGE);
    expect(renderAccountingCsv(EXPENSE_JOURNAL_COLUMNS, exp, t)).toContain('Rent;note;40.00;EUR');
    const summary = buildAccountingSummary([], exp);
    expect(renderAccountingCsv(SUMMARY_COLUMNS, summary, t)).toContain('EUR;expenseCategory;Rent;1;40.00;0.00;40.00');
  });

  it('has a translation of every column header in both bundled languages', () => {
    for (const col of [...SALES_JOURNAL_COLUMNS, ...EXPENSE_JOURNAL_COLUMNS, ...SUMMARY_COLUMNS]) {
      expect(BUNDLED_MESSAGES.tr[col.labelKey]).toBeTruthy();
      expect(BUNDLED_MESSAGES.en[col.labelKey]).toBeTruthy();
    }
  });
});

describe('query schema and json', () => {
  it('applies defaults and accepts delimiter names or characters', () => {
    const q = AccountingExportQuerySchema.parse({ from: '2026-09-01', to: '2026-09-30', delimiter: ',' });
    expect(q).toMatchObject({ kind: 'sales', format: 'csv', delimiter: 'comma' });
    expect(AccountingExportQuerySchema.parse({ from: '2026-09-01', to: '2026-09-30' }).delimiter).toBe('semicolon');
  });

  it('rejects a reversed or overlong range and a bad locale', () => {
    expect(AccountingExportQuerySchema.safeParse({ from: '2026-09-30', to: '2026-09-01' }).success).toBe(false);
    expect(AccountingExportQuerySchema.safeParse({ from: '2024-01-01', to: '2026-09-01' }).success).toBe(false);
    expect(AccountingExportQuerySchema.safeParse({ locale: 'not a locale' }).success).toBe(false);
  });

  it('describes the query in the JSON body', () => {
    const json = buildAccountingJson('sales', RANGE, null, [{ a: 1 }]);
    expect(json).toMatchObject({ kind: 'sales', branchId: null, rowCount: 1 });
  });
});

describe('webhook sample catalogue', () => {
  it('has a sample for every event and nothing else', () => {
    expect(Object.keys(WEBHOOK_SAMPLE_DATA).sort()).toEqual([...ALL_WEBHOOK_EVENTS].sort());
  });

  it('wraps a sample in the delivery envelope', () => {
    const now = new Date('2026-09-29T10:00:00Z');
    expect(webhookSamplePayload('lead.created', 'studio-1', now)).toEqual({
      event: 'lead.created',
      studioId: 'studio-1',
      occurredAt: now.toISOString(),
      data: WEBHOOK_SAMPLE_DATA['lead.created'],
    });
  });
});
