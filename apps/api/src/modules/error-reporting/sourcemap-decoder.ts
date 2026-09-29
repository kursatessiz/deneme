import { ERROR_LIMITS } from '@platform/shared';

/**
 * Minimal source map v3 reader (H2, docs/HATA_RAPORLAMA.md): a base64 VLQ
 * decoder, a position lookup and a stack rewriter. Written in-house because
 * the workspace has no source-map dependency. It never throws on bad input
 * (a malformed map or stack yields null) and never builds a full index: a
 * lookup scans the mappings string once, so a 10 MB map costs a few
 * milliseconds and no retained memory beyond the string itself.
 */

export interface RawSourceMap {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
  sourceRoot?: string;
}

export interface OriginalPosition {
  /** Display path of the original file. */
  source: string;
  /** 1-based. */
  line: number;
  /** 0-based. */
  column: number;
  name: string | null;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i++) DIGIT[BASE64.charCodeAt(i)] = i;

const MAX_VLQ_SHIFT = 30;

/**
 * Reads one base64 VLQ value from `text` at `pos`. Returns the signed value
 * and the index after it, or null for a bad digit or a value beyond 32 bits.
 */
export function decodeVlq(text: string, pos: number): { value: number; next: number } | null {
  let result = 0;
  let shift = 0;
  let i = pos;
  for (;;) {
    if (i >= text.length) return null;
    const code = text.charCodeAt(i++);
    const digit = code < 128 ? DIGIT[code] : -1;
    if (digit < 0) return null;
    result += (digit & 31) * 2 ** shift;
    if ((digit & 32) === 0) break;
    shift += 5;
    if (shift > MAX_VLQ_SHIFT) return null;
  }
  const magnitude = Math.floor(result / 2);
  return { value: result % 2 === 1 ? -magnitude : magnitude, next: i };
}

/** Parses a source map v3 JSON text; null when it is not a plain (non-indexed) v3 map. */
export function parseSourceMap(text: string): RawSourceMap | null {
  try {
    const raw = JSON.parse(text) as Partial<RawSourceMap> & { sections?: unknown };
    if (!raw || raw.version !== 3 || raw.sections !== undefined) return null;
    if (typeof raw.mappings !== 'string' || !Array.isArray(raw.sources)) return null;
    return {
      version: 3,
      sources: raw.sources.map((s) => (typeof s === 'string' ? s : '')),
      names: Array.isArray(raw.names) ? raw.names.map((n) => (typeof n === 'string' ? n : '')) : [],
      mappings: raw.mappings,
      ...(typeof raw.sourceRoot === 'string' ? { sourceRoot: raw.sourceRoot } : {}),
    };
  } catch {
    return null;
  }
}

/** Display form of a source path: no bundler scheme, no leading "./" or "../". */
export function displaySource(map: RawSourceMap, index: number): string {
  let source = map.sources[index] ?? '';
  if (map.sourceRoot && !source.includes('://') && !source.startsWith('/')) {
    source = `${map.sourceRoot.replace(/\/+$/, '')}/${source}`;
  }
  const scheme = source.indexOf('://');
  if (scheme > 0 && scheme <= 16) {
    // webpack://name/path -> path; file:///abs/path -> /abs/path
    const rest = source.slice(scheme + 3);
    source = source.slice(0, scheme) === 'file' ? rest : rest.slice(rest.indexOf('/') + 1);
  }
  while (source.startsWith('./') || source.startsWith('../')) source = source.slice(source.startsWith('./') ? 2 : 3);
  return source || '<unknown>';
}

/**
 * The original position of a generated position. `line` is 1-based and
 * `column` 0-based (stack traces print 1-based columns: pass column - 1).
 * The mapping used is the last one on the line that starts at or before the
 * column, like every source map consumer.
 */
export function originalPositionFor(map: RawSourceMap, line: number, column: number): OriginalPosition | null {
  const text = map.mappings;
  const length = text.length;
  let genLine = 1;
  let genCol = 0;
  let source = 0;
  let origLine = 0;
  let origCol = 0;
  let name = 0;
  let best: { source: number; line: number; column: number; name: number } | null = null;
  let i = 0;
  while (i < length) {
    const ch = text.charCodeAt(i);
    if (ch === 59) {
      genLine++;
      genCol = 0;
      i++;
      if (genLine > line) break;
      continue;
    }
    if (ch === 44) {
      i++;
      continue;
    }
    const fields: number[] = [];
    while (i < length && fields.length < 5) {
      const next = text.charCodeAt(i);
      if (next === 44 || next === 59) break;
      const decoded = decodeVlq(text, i);
      if (!decoded) return null;
      fields.push(decoded.value);
      i = decoded.next;
    }
    // A segment has 1, 4 or 5 fields; anything else, or trailing digits, is malformed.
    if (fields.length === 0 || fields.length === 2 || fields.length === 3) return null;
    if (i < length && text.charCodeAt(i) !== 44 && text.charCodeAt(i) !== 59) return null;
    genCol += fields[0];
    if (fields.length >= 4) {
      source += fields[1];
      origLine += fields[2];
      origCol += fields[3];
      if (fields.length === 5) name += fields[4];
    }
    if (genLine === line) {
      if (genCol > column) break;
      best = fields.length >= 4 ? { source, line: origLine, column: origCol, name: fields.length === 5 ? name : -1 } : null;
    }
  }
  if (!best || best.source < 0 || best.source >= map.sources.length) return null;
  return {
    source: displaySource(map, best.source),
    line: best.line + 1,
    column: best.column,
    name: best.name >= 0 && best.name < map.names.length ? map.names[best.name] || null : null,
  };
}

// ---------------------------------------------------------------------------
// Stack rewriting
// ---------------------------------------------------------------------------

interface ParsedFrame {
  indent: string;
  style: 'at' | 'moz';
  asyncPrefix: string;
  fn: string;
  url: string;
  line: number;
  column: number;
}

function allDigits(value: string): boolean {
  if (value.length === 0 || value.length > 9) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

/**
 * Parses one stack line: V8/Hermes ("at fn (url:1:2)", "at url:1:2",
 * "at fn (address at url:1:2)") and Firefox/Safari ("fn@url:1:2").
 */
export function parseFrame(rawLine: string): ParsedFrame | null {
  if (rawLine.length > 1000) return null;
  const trimmed = rawLine.trimStart();
  const indent = rawLine.slice(0, rawLine.length - trimmed.length);
  let style: 'at' | 'moz';
  let fn = '';
  let asyncPrefix = '';
  let location: string;
  if (trimmed.startsWith('at ')) {
    style = 'at';
    let rest = trimmed.slice(3);
    if (rest.startsWith('async ')) {
      asyncPrefix = 'async ';
      rest = rest.slice(6);
    }
    const paren = rest.lastIndexOf(' (');
    if (paren !== -1 && rest.endsWith(')')) {
      fn = rest.slice(0, paren);
      location = rest.slice(paren + 2, -1);
    } else {
      location = rest;
    }
    if (location.startsWith('address at ')) location = location.slice(11);
  } else {
    const at = trimmed.indexOf('@');
    if (at === -1) return null;
    style = 'moz';
    fn = trimmed.slice(0, at);
    location = trimmed.slice(at + 1);
  }
  const colonB = location.lastIndexOf(':');
  if (colonB <= 0) return null;
  const colonA = location.lastIndexOf(':', colonB - 1);
  if (colonA <= 0) return null;
  const lineText = location.slice(colonA + 1, colonB);
  const columnText = location.slice(colonB + 1);
  if (!allDigits(lineText) || !allDigits(columnText)) return null;
  const url = location.slice(0, colonA);
  if (!url) return null;
  return { indent, style, asyncPrefix, fn, url, line: Number(lineText), column: Number(columnText) };
}

export type MapLoader = (frameUrl: string) => Promise<RawSourceMap | null>;

const MAX_FRAMES = 100;
const MAX_LOADS = 6;

/**
 * Rewrites every resolvable frame of `stack` to its original file, line,
 * column and (when the map has one) function name. Frames without a map or
 * a mapping are kept unchanged. Null when nothing could be resolved, so the
 * caller stores no symbolicated stack. `load` gets the frame's URL.
 */
export async function symbolicateStack(stack: string, load: MapLoader): Promise<string | null> {
  const lines = stack.split('\n', MAX_FRAMES + 20);
  const maps = new Map<string, RawSourceMap | null>();
  let resolved = 0;
  let frames = 0;
  const out: string[] = [];
  for (const line of lines) {
    const frame = frames < MAX_FRAMES ? parseFrame(line) : null;
    if (!frame) {
      out.push(line);
      continue;
    }
    frames++;
    let map = maps.get(frame.url);
    if (map === undefined) {
      map = maps.size < MAX_LOADS ? await load(frame.url) : null;
      maps.set(frame.url, map);
    }
    const original = map && frame.column >= 1 ? originalPositionFor(map, frame.line, frame.column - 1) : null;
    if (!original) {
      out.push(line);
      continue;
    }
    resolved++;
    const name = original.name ?? frame.fn;
    const where = `${original.source}:${original.line}:${original.column + 1}`;
    out.push(
      frame.style === 'moz'
        ? `${frame.indent}${name}@${where}`
        : `${frame.indent}at ${frame.asyncPrefix}${name ? `${name} (${where})` : where}`,
    );
  }
  if (resolved === 0) return null;
  const joined = out.join('\n');
  return joined.length > ERROR_LIMITS.stackLength * 2 ? joined.slice(0, ERROR_LIMITS.stackLength * 2) : joined;
}
