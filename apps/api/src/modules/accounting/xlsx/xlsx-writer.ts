/**
 * Minimal, dependency-free XLSX (Office Open XML SpreadsheetML) writer.
 *
 * Deliberately small and safe: cells are numbers, inline strings or dates
 * (numbers with a date format); a formula element is never written, so text
 * such as "=cmd" stays a plain string and is never evaluated. Strings are
 * inline, which avoids a shared-strings part.
 */
import { MAX_SHEET_NAME_LENGTH, buildZip, cellRef, escapeXml, excelSerialDate, sanitizeSheetName, stripInvalidXmlChars } from './xlsx-primitives';
import type { ZipEntry } from './xlsx-primitives';

/** Excel's limit of characters in one cell. */
const MAX_CELL_TEXT = 32767;
const MAX_ROWS = 1048576;
const MAX_COLUMNS = 16384;

export type XlsxCell =
  | { type: 'string'; value: string; bold?: boolean }
  | { type: 'number'; value: number; numFmt?: string; bold?: boolean }
  | { type: 'date'; value: Date; numFmt: string; bold?: boolean };

export interface XlsxSheet {
  /** Sanitised to Excel's rules and made unique by the writer. */
  name: string;
  /** Rows of cells from row 1; null leaves a cell empty (a whole empty array is a blank row). */
  rows: readonly (readonly (XlsxCell | null)[])[];
  /** Column widths in characters, from column 1. */
  columnWidths?: readonly number[];
  /** Freezes the first row. */
  freezeHeader?: boolean;
  /** Auto filter range as an A1 reference such as "A1:K20". */
  autoFilter?: string;
}

export interface XlsxWorkbook {
  sheets: readonly XlsxSheet[];
  /** Stamp of docProps/core.xml; defaults to now. */
  created?: Date;
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Built-in Excel number format ids for the formats that have one. */
const BUILTIN_NUM_FMTS: Readonly<Record<string, number>> = { '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4 };
const FIRST_CUSTOM_NUM_FMT = 164;

interface StyleKey {
  numFmt: string | null;
  bold: boolean;
}

/** Collects the distinct (number format, bold) combinations of the workbook and maps them to cellXfs indexes. */
class StyleRegistry {
  private readonly styles: StyleKey[] = [{ numFmt: null, bold: false }];
  private readonly index = new Map<string, number>([['|0', 0]]);

  indexOf(numFmt: string | undefined, bold: boolean | undefined): number {
    const key: StyleKey = { numFmt: numFmt ?? null, bold: bold === true };
    const id = `${key.numFmt ?? ''}|${key.bold ? 1 : 0}`;
    const existing = this.index.get(id);
    if (existing !== undefined) return existing;
    this.styles.push(key);
    this.index.set(id, this.styles.length - 1);
    return this.styles.length - 1;
  }

  xml(): string {
    const custom: string[] = [];
    const idOf = new Map<string, number>();
    for (const style of this.styles) {
      if (style.numFmt === null || style.numFmt in BUILTIN_NUM_FMTS || idOf.has(style.numFmt)) continue;
      const id = FIRST_CUSTOM_NUM_FMT + custom.length;
      idOf.set(style.numFmt, id);
      custom.push(`<numFmt numFmtId="${id}" formatCode="${escapeXml(style.numFmt)}"/>`);
    }
    const xfs = this.styles.map((style) => {
      const numFmtId = style.numFmt === null ? 0 : (BUILTIN_NUM_FMTS[style.numFmt] ?? idOf.get(style.numFmt) ?? 0);
      const attrs = [`numFmtId="${numFmtId}"`, `fontId="${style.bold ? 1 : 0}"`, 'fillId="0"', 'borderId="0"', 'xfId="0"'];
      if (numFmtId !== 0) attrs.push('applyNumberFormat="1"');
      if (style.bold) attrs.push('applyFont="1"');
      return `<xf ${attrs.join(' ')}/>`;
    });
    return (
      XML_DECLARATION +
      `<styleSheet xmlns="${NS_MAIN}">` +
      (custom.length > 0 ? `<numFmts count="${custom.length}">${custom.join('')}</numFmts>` : '') +
      '<fonts count="2">' +
      '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
      '</fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>'
    );
  }
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('Cell numbers must be finite');
  return String(value);
}

function cellXml(cell: XlsxCell, ref: string, styles: StyleRegistry): string {
  switch (cell.type) {
    case 'number': {
      const s = styles.indexOf(cell.numFmt, cell.bold);
      return `<c r="${ref}"${s ? ` s="${s}"` : ''} t="n"><v>${numberText(cell.value)}</v></c>`;
    }
    case 'date': {
      const s = styles.indexOf(cell.numFmt, cell.bold);
      return `<c r="${ref}"${s ? ` s="${s}"` : ''} t="n"><v>${numberText(excelSerialDate(cell.value))}</v></c>`;
    }
    case 'string': {
      const s = styles.indexOf(undefined, cell.bold);
      const text = escapeXml(stripInvalidXmlChars(cell.value).slice(0, MAX_CELL_TEXT));
      return `<c r="${ref}"${s ? ` s="${s}"` : ''} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
    }
  }
}

function sheetXml(sheet: XlsxSheet, styles: StyleRegistry): string {
  if (sheet.rows.length > MAX_ROWS) throw new RangeError('Too many rows for one sheet');
  const rows: string[] = [];
  sheet.rows.forEach((cells, r) => {
    if (cells.length > MAX_COLUMNS) throw new RangeError('Too many columns for one sheet');
    const xml = cells.map((cell, c) => (cell === null ? '' : cellXml(cell, cellRef(c + 1, r + 1), styles))).join('');
    if (xml !== '') rows.push(`<row r="${r + 1}">${xml}</row>`);
  });
  const cols = (sheet.columnWidths ?? []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${numberText(w)}" customWidth="1"/>`).join('');
  return (
    XML_DECLARATION +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    '<sheetViews><sheetView workbookViewId="0">' +
    (sheet.freezeHeader ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '') +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rows.join('')}</sheetData>` +
    (sheet.autoFilter ? `<autoFilter ref="${escapeXml(sheet.autoFilter)}"/>` : '') +
    '</worksheet>'
  );
}

/** Sanitised, case-insensitively unique sheet names (Excel compares sheet names without case). */
function uniqueSheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = sanitizeSheetName(raw);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = base.slice(0, MAX_SHEET_NAME_LENGTH - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** "A1:K20" as an absolute reference "$A$1:$K$20" for the filter defined name. */
function absoluteRange(ref: string): string {
  return ref.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
}

/** Builds the XLSX file (a ZIP container) of the workbook. */
export function buildXlsx(workbook: XlsxWorkbook): Buffer {
  if (workbook.sheets.length === 0) throw new RangeError('A workbook needs at least one sheet');
  const styles = new StyleRegistry();
  const names = uniqueSheetNames(workbook.sheets.map((s) => s.name));
  const sheetParts = workbook.sheets.map((sheet) => sheetXml(sheet, styles));
  const created = (workbook.created ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const definedNames = workbook.sheets
    .map((sheet, i) =>
      sheet.autoFilter
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escapeXml(names[i].replace(/'/g, "''"))}'!${escapeXml(absoluteRange(sheet.autoFilter))}</definedName>`
        : '',
    )
    .join('');

  const entries: ZipEntry[] = [];
  const add = (name: string, xml: string): void => {
    entries.push({ name, data: Buffer.from(xml, 'utf8') });
  };

  add(
    '[Content_Types].xml',
    XML_DECLARATION +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      workbook.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>',
  );
  add(
    '_rels/.rels',
    XML_DECLARATION +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${REL_BASE}/officeDocument" Target="xl/workbook.xml"/>` +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      `<Relationship Id="rId3" Type="${REL_BASE}/extended-properties" Target="docProps/app.xml"/>` +
      '</Relationships>',
  );
  add(
    'xl/workbook.xml',
    XML_DECLARATION +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      '<bookViews><workbookView/></bookViews>' +
      `<sheets>${names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
      (definedNames ? `<definedNames>${definedNames}</definedNames>` : '') +
      '</workbook>',
  );
  const stylesRel = workbook.sheets.length + 1;
  add(
    'xl/_rels/workbook.xml.rels',
    XML_DECLARATION +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      workbook.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_BASE}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${stylesRel}" Type="${REL_BASE}/styles" Target="styles.xml"/>` +
      '</Relationships>',
  );
  add('xl/styles.xml', styles.xml());
  sheetParts.forEach((xml, i) => add(`xl/worksheets/sheet${i + 1}.xml`, xml));
  add(
    'docProps/core.xml',
    XML_DECLARATION +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>` +
      '</cp:coreProperties>',
  );
  add(
    'docProps/app.xml',
    XML_DECLARATION +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
      '<Application>Platform</Application>' +
      '</Properties>',
  );

  return buildZip(entries);
}
