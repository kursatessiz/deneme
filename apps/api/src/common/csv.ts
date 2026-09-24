/**
 * CSV for spreadsheet users in Turkey: UTF-8 BOM so Excel detects the
 * encoding, semicolon separators (comma is the decimal mark in tr-TR),
 * RFC 4180 quoting, and neutralised formula prefixes so a member-supplied
 * value such as "=HYPERLINK(...)" is shown as text instead of executed.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [headers.map(csvCell).join(';'), ...rows.map((row) => row.map(csvCell).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}
