import { ACCOUNTING_DATE_FORMAT, accountingAmountFormat, accountingSheetCell, accountingSheetGroups, accountingSheetTotals } from '@platform/shared';
import type { AccountingColumn, AccountingSheetCell } from '@platform/shared';
import { cellRef } from './xlsx/xlsx-primitives';
import { buildXlsx } from './xlsx/xlsx-writer';
import type { XlsxCell, XlsxSheet } from './xlsx/xlsx-writer';

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MIN_WIDTH = 10;
const MAX_WIDTH = 50;

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

/**
 * Only strings, numbers and dates are ever produced: the writer has no
 * formula cell type, so text such as "=cmd" stays an inline string and is
 * never evaluated by the spreadsheet.
 */
function toXlsxCell(value: AccountingSheetCell, bold = false): XlsxCell {
  if (value.type === 'number') return { type: 'number', value: value.value, numFmt: value.numFmt, bold };
  if (value.type === 'date') return { type: 'date', value: value.value, numFmt: ACCOUNTING_DATE_FORMAT, bold };
  return { type: 'string', value: value.value, bold };
}

/** Rough printed length of a cell, for the column width. */
function printedLength(value: AccountingSheetCell): number {
  if (value.type === 'date') return ACCOUNTING_DATE_FORMAT.length;
  if (value.type === 'number') return value.value.toFixed(2).length + Math.floor(Math.abs(value.value)).toString().length / 3;
  return value.value.length;
}

/**
 * The accounting export as an XLSX workbook (docs/MUHASEBE.md, "XLSX"): one
 * sheet per currency, named by the currency code, so no sheet ever mixes
 * two currencies. Every sheet has a bold, frozen, auto-filtered header row
 * in the requested language; amounts are numbers with the currency's minor
 * digits, dates are date cells (UTC), everything else is a string. Journals
 * end with a bold totals row computed in minor units, never a formula.
 * Written by the dependency-free writer in ./xlsx.
 */
export function buildAccountingWorkbook<Row extends { currency: string }>(input: AccountingWorkbookInput<Row>): Buffer {
  const { columns, t } = input;
  const sheets: XlsxSheet[] = [];

  for (const group of accountingSheetGroups(input.rows, input.fallbackCurrency)) {
    const widths = columns.map((c) => t(c.labelKey).length);
    const rows: (XlsxCell | null)[][] = [columns.map((column): XlsxCell => ({ type: 'string', value: t(column.labelKey), bold: true }))];

    for (const row of group.rows) {
      rows.push(
        columns.map((column, i) => {
          const value = accountingSheetCell(column, row, group.currency);
          widths[i] = Math.max(widths[i], printedLength(value));
          return toXlsxCell(value);
        }),
      );
    }

    if (input.totals && group.rows.length > 0) {
      // One empty row keeps the totals outside the filtered range.
      rows.push([]);
      const totals: (XlsxCell | null)[] = columns.map(() => null);
      totals[0] = { type: 'string', value: t('accounting.xlsx.total'), bold: true };
      accountingSheetTotals(columns, group.rows, group.currency).forEach((total, i) => {
        if (total === null) return;
        const value: AccountingSheetCell = { type: 'number', value: total, numFmt: accountingAmountFormat(group.currency) };
        totals[i] = toXlsxCell(value, true);
        widths[i] = Math.max(widths[i], printedLength(value));
      });
      rows.push(totals);
    }

    sheets.push({
      name: group.currency,
      rows,
      columnWidths: widths.map((width) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(width) + 2))),
      freezeHeader: true,
      autoFilter: `${cellRef(1, 1)}:${cellRef(columns.length, 1 + group.rows.length)}`,
    });
  }

  return buildXlsx({ sheets });
}
