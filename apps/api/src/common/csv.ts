/**
 * Semicolon-separated CSV for Excel (Turkish locale): UTF-8 BOM prefix,
 * `;` as the field separator, `"` escaped by doubling per RFC 4180.
 */
const BOM = '﻿';

function escapeField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[";\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Builds a full CSV document (header row + data rows) with a BOM prefix. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeField).join(';'));
  return BOM + lines.join('\r\n') + '\r\n';
}
