import { Workbook } from 'exceljs';
import type { Cell } from 'exceljs';
import { ACCOUNTING_DATE_FORMAT, accountingAmountFormat, accountingSheetCell, accountingSheetGroups, accountingSheetTotals } from '@platform/shared';
import type { AccountingColumn, AccountingSheetCell } from '@platform/shared';

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MIN_WIDTH = 10;
const MAX_WIDTH = 50;
/** Characters that Excel refuses in a sheet name. */
const SHEET_NAME_FORBIDDEN = /[\\/?*[\]:]/g;

export interface AccountingWorkbookInput<Row extends { currency: string }> {
  columns: readonly AccountingColumn<Row>[];
  rows: readonly Row[];
  /** Header labels and the totals label, already in the requested language. */
  t: (key: string) => string;
  /** Sheet of an empty export (the studio currency). */
  fallbackCurrency: string;
  /** Adds a bold totals row under each sheet's data (journals; not the summary). */
  totals: boolean;
}

function setCell(cell: Cell, value: AccountingSheetCell): void {
  // Only strings, numbers and dates are ever assigned: exceljs writes a
  // formula only for a { formula } object, so text such as "=cmd" stays a
  // plain string cell and is never evaluated by the spreadsheet.
  if (value.type === 'number') {
    cell.value = value.value;
    cell.numFmt = value.numFmt;
  } else if (value.type === 'date') {
    cell.value = value.value;
    cell.numFmt = ACCOUNTING_DATE_FORMAT;
  } else {
    cell.value = value.value;
  }
}

/** Rough printed length of a cell, for the column width. */
function printedLength(value: AccountingSheetCell): number {
  if (value.type === 'date') return ACCOUNTING_DATE_FORMAT.length;
  if (value.type === 'number') return value.value.toFixed(2).length + Math.floor(Math.abs(value.value)).toString().length / 3;
  return value.value.length;
}

function sheetName(currency: string): string {
  const name = currency.replace(SHEET_NAME_FORBIDDEN, '_').slice(0, 31);
  return name || '_';
}

/**
 * The accounting export as an XLSX workbook (docs/MUHASEBE.md, "XLSX"): one
 * sheet per currency, named by the currency code, so no sheet ever mixes
 * two currencies. Every sheet has a bold, frozen, auto-filtered header row
 * in the requested language; amounts are numbers with the currency's minor
 * digits, dates are date cells (UTC), everything else is a string. Journals
 * end with a bold totals row computed in minor units, never a formula.
 */
export async function buildAccountingWorkbook<Row extends { currency: string }>(input: AccountingWorkbookInput<Row>): Promise<Buffer> {
  const { columns, t } = input;
  const workbook = new Workbook();
  workbook.created = new Date();

  for (const group of accountingSheetGroups(input.rows, input.fallbackCurrency)) {
    const sheet = workbook.addWorksheet(sheetName(group.currency), { views: [{ state: 'frozen', ySplit: 1 }] });
    const widths = columns.map((c) => t(c.labelKey).length);

    const header = sheet.getRow(1);
    columns.forEach((column, i) => {
      header.getCell(i + 1).value = t(column.labelKey);
    });
    header.font = { bold: true };

    group.rows.forEach((row, r) => {
      const line = sheet.getRow(r + 2);
      columns.forEach((column, i) => {
        const value = accountingSheetCell(column, row, group.currency);
        setCell(line.getCell(i + 1), value);
        widths[i] = Math.max(widths[i], printedLength(value));
      });
    });

    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + group.rows.length, column: columns.length } };

    if (input.totals && group.rows.length > 0) {
      // One empty row keeps the totals outside the filtered range.
      const totalsRow = sheet.getRow(group.rows.length + 3);
      setCell(totalsRow.getCell(1), { type: 'text', value: t('accounting.xlsx.total') });
      accountingSheetTotals(columns, group.rows, group.currency).forEach((total, i) => {
        if (total === null) return;
        const value: AccountingSheetCell = { type: 'number', value: total, numFmt: accountingAmountFormat(group.currency) };
        setCell(totalsRow.getCell(i + 1), value);
        widths[i] = Math.max(widths[i], printedLength(value));
      });
      totalsRow.font = { bold: true };
    }

    widths.forEach((width, i) => {
      sheet.getColumn(i + 1).width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(width) + 2));
    });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
