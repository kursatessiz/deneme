/**
 * Pure building blocks of the dependency-free XLSX writer: CRC-32, XML
 * escaping, cell reference math, Excel date serials, sheet name rules and
 * the ZIP container. Only Node's zlib (deflateRawSync) is used; zlib.crc32
 * is deliberately avoided because the supported engines include Node 20.
 */
import { deflateRawSync } from 'zlib';

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, as used by ZIP) of the given bytes, as an unsigned 32-bit integer. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Characters that XML 1.0 cannot carry: control characters except tab, LF
 * and CR, the noncharacters U+FFFE / U+FFFF and unpaired surrogates.
 */
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Removes characters that are invalid in XML 1.0. */
export function stripInvalidXmlChars(text: string): string {
  return text.replace(INVALID_XML_CHARS, '');
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\r': '&#13;' };

/** Escapes text for XML element content and attribute values after stripping invalid characters. */
export function escapeXml(text: string): string {
  return stripInvalidXmlChars(text).replace(/[&<>"'\r]/g, (ch) => XML_ESCAPES[ch]);
}

/** Column letters of a 1-based column number: 1 -> A, 26 -> Z, 27 -> AA, 703 -> AAA. */
export function columnLetters(column: number): string {
  if (!Number.isInteger(column) || column < 1 || column > 16384) throw new RangeError(`Column out of range: ${column}`);
  let n = column;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** A1-style reference of a 1-based column and row. */
export function cellRef(column: number, row: number): string {
  if (!Number.isInteger(row) || row < 1 || row > 1048576) throw new RangeError(`Row out of range: ${row}`);
  return `${columnLetters(column)}${row}`;
}

const MS_PER_DAY = 86_400_000;
/** Excel serial number of 1970-01-01 in the 1900 date system. */
const UNIX_EPOCH_SERIAL = 25569;

/**
 * Excel serial date (1900 system, UTC) with the time as a day fraction.
 * Dates before 1900-03-01 are shifted by one day to account for Excel's
 * fictitious 1900-02-29.
 */
export function excelSerialDate(date: Date): number {
  const ms = date.getTime();
  if (Number.isNaN(ms)) throw new RangeError('Invalid date');
  const serial = ms / MS_PER_DAY + UNIX_EPOCH_SERIAL;
  if (serial < 1) throw new RangeError('Date before 1900-01-01 cannot be written');
  return serial < 61 ? serial - 1 : serial;
}

/** Sheet name limit and forbidden characters of Excel. */
const SHEET_NAME_FORBIDDEN = /[\\/?*[\]:]/g;
export const MAX_SHEET_NAME_LENGTH = 31;

/** Sanitises a sheet name to Excel's rules: at most 31 characters, none of [ ] : * ? / \, no edge apostrophes, never empty. */
export function sanitizeSheetName(name: string): string {
  const cleaned = stripInvalidXmlChars(name)
    .replace(SHEET_NAME_FORBIDDEN, '_')
    .slice(0, MAX_SHEET_NAME_LENGTH)
    .replace(/^'+|'+$/g, '');
  return cleaned === '' ? '_' : cleaned;
}

export interface ZipEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  name: string;
  data: Buffer;
}

const ZIP_MAX = 0xffffffff;
/** 1980-01-01 00:00:00 in MS-DOS format; a fixed stamp keeps the output reproducible. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** General purpose flag bit 11: file names are UTF-8. */
const FLAG_UTF8 = 0x0800;
const VERSION = 20;
const METHOD_DEFLATE = 8;

/** Builds a ZIP archive (deflate, no ZIP64). Throws when a limit of the classic format would be exceeded. */
export function buildZip(entries: readonly ZipEntry[]): Buffer {
  if (entries.length > 0xffff) throw new RangeError('Too many ZIP entries');
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    if (name.length > 0xffff) throw new RangeError('ZIP entry name too long');
    if (entry.data.length > ZIP_MAX) throw new RangeError('ZIP entry larger than 4 GB');
    const compressed = deflateRawSync(entry.data);
    if (compressed.length > ZIP_MAX) throw new RangeError('ZIP entry larger than 4 GB');
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
    if (offset > ZIP_MAX) throw new RangeError('ZIP archive larger than 4 GB');
  }

  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  if (offset + centralSize > ZIP_MAX) throw new RangeError('ZIP archive larger than 4 GB');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
