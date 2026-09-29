/**
 * Test-only ZIP reader: parses the central directory and inflates each
 * entry, verifying size and CRC-32. Used by the XLSX unit and e2e tests as
 * an independent check of the writer's container. Not imported by
 * production code.
 */
import { inflateRawSync } from 'zlib';
import { crc32 } from './xlsx-primitives';

export function readZip(buffer: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('End of central directory not found');
  const count = buffer.readUInt16LE(eocd + 10);
  let pos = buffer.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error('Bad central directory entry');
    const flags = buffer.readUInt16LE(pos + 8);
    const method = buffer.readUInt16LE(pos + 10);
    const crc = buffer.readUInt32LE(pos + 16);
    const csize = buffer.readUInt32LE(pos + 20);
    const usize = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    if ((flags & 0x0800) === 0) throw new Error('UTF-8 flag missing');
    const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Bad local header');
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (method !== 8) throw new Error(`Unexpected method ${method}`);
    const data = inflateRawSync(buffer.subarray(dataStart, dataStart + csize));
    if (data.length !== usize) throw new Error(`Size mismatch for ${name}`);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`);
    files.set(name, data);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** The archive as a name to UTF-8 text map. */
export function readZipText(buffer: Buffer): Map<string, string> {
  return new Map([...readZip(buffer)].map(([name, data]) => [name, data.toString('utf8')]));
}

export interface ParsedCell {
  ref: string;
  /** Raw t attribute ('n' when absent). */
  t: string;
  /** Style index (cellXfs), 0 when absent. */
  s: number;
  /** Text of the value: the v element for numbers, the is/t element for inline strings (still XML-escaped). */
  value: string;
  hasFormula: boolean;
}

/** Cells of a worksheet XML in document order, keyed by row number. */
export function parseSheetCells(sheetXml: string): Map<number, ParsedCell[]> {
  const rows = new Map<number, ParsedCell[]>();
  const rowRe = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  for (let m = rowRe.exec(sheetXml); m; m = rowRe.exec(sheetXml)) {
    const cells: ParsedCell[] = [];
    const cellRe = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    for (let c = cellRe.exec(m[2]); c; c = cellRe.exec(m[2])) {
      const attrs = c[2];
      const body = c[3] ?? '';
      const text = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body) ?? /<v>([\s\S]*?)<\/v>/.exec(body);
      cells.push({
        ref: c[1],
        t: /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n',
        s: Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? 0),
        value: text ? text[1] : '',
        hasFormula: /<f[ >/]/.test(body),
      });
    }
    rows.set(Number(m[1]), cells);
  }
  return rows;
}
