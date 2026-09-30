import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { SOURCEMAP_LIMITS, normalizeSourcemapPath, sourcemapPathCandidates } from '@platform/shared';
import { decodeVlq, originalPositionFor, parseFrame, parseSourceMap, symbolicateStack, symbolicateStackDetailed } from './sourcemap-decoder';
import type { RawSourceMap } from './sourcemap-decoder';
import { SourcemapStoreError, SourcemapStoreService } from './sourcemap-store.service';
import { SymbolicationService } from './symbolication.service';

/** Test-only base64 VLQ encoder, the inverse of decodeVlq. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function encodeVlq(value: number): string {
  let v = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += B64[digit];
  } while (v > 0);
  return out;
}

type Segment = [genCol: number, source: number, origLine: number, origCol: number, name?: number];
/** Absolute segments per generated line -> the relative "mappings" string. */
function encodeMappings(lines: Segment[][]): string {
  let source = 0;
  let origLine = 0;
  let origCol = 0;
  let name = 0;
  return lines
    .map((segments) => {
      let genCol = 0;
      return segments
        .map((s) => {
          let out = encodeVlq(s[0] - genCol) + encodeVlq(s[1] - source) + encodeVlq(s[2] - origLine) + encodeVlq(s[3] - origCol);
          genCol = s[0];
          source = s[1];
          origLine = s[2];
          origCol = s[3];
          if (s[4] !== undefined) {
            out += encodeVlq(s[4] - name);
            name = s[4];
          }
          return out;
        })
        .join(',');
    })
    .join(';');
}

/**
 * Generated line 1 is the minified bundle `function a(b){throw new Error(b)}a("x")`;
 * the original is src/app.ts (0-based lines): "export function fail(msg) {" (0),
 * "  throw new Error(msg);" (1). Generated line 2 maps back to line 9, column 4 of src/util.ts.
 */
const MAP: RawSourceMap = {
  version: 3,
  sources: ['webpack://_N_E/./src/app.ts', 'webpack://_N_E/./src/util.ts'],
  names: ['fail', 'Error'],
  mappings: encodeMappings([
    [
      [0, 0, 0, 0, 0],
      [14, 0, 1, 2],
      [20, 0, 1, 8, 1],
      [30, 0, 1, 20],
    ],
    [[0, 1, 9, 4]],
  ]),
};

describe('decodeVlq', () => {
  it('decodes known values', () => {
    expect(decodeVlq('A', 0)).toEqual({ value: 0, next: 1 });
    expect(decodeVlq('C', 0)).toEqual({ value: 1, next: 1 });
    expect(decodeVlq('D', 0)).toEqual({ value: -1, next: 1 });
    expect(decodeVlq('gB', 0)).toEqual({ value: 16, next: 2 });
    expect(decodeVlq('hB', 0)).toEqual({ value: -16, next: 2 });
    expect(decodeVlq('2H', 0)).toEqual({ value: 123, next: 2 });
  });

  it('round-trips a range of values and reads from an offset', () => {
    for (const v of [0, 1, -1, 15, 16, -16, 1000, -1000, 123456, -123456, 2 ** 28]) {
      const enc = encodeVlq(v);
      expect(decodeVlq(`,${enc};`, 1)).toEqual({ value: v === 0 ? 0 : v, next: 1 + enc.length });
    }
  });

  it('returns null for a bad digit, a missing continuation or an oversized value', () => {
    expect(decodeVlq('!', 0)).toBeNull();
    expect(decodeVlq('g', 0)).toBeNull();
    expect(decodeVlq('gggggggggg', 0)).toBeNull();
    expect(decodeVlq('', 0)).toBeNull();
  });
});

describe('originalPositionFor', () => {
  it('resolves the mapping that starts at or before the column', () => {
    expect(originalPositionFor(MAP, 1, 0)).toEqual({ source: 'src/app.ts', sourceIndex: 0, line: 1, column: 0, name: 'fail' });
    expect(originalPositionFor(MAP, 1, 14)).toEqual({ source: 'src/app.ts', sourceIndex: 0, line: 2, column: 2, name: null });
    expect(originalPositionFor(MAP, 1, 25)).toEqual({ source: 'src/app.ts', sourceIndex: 0, line: 2, column: 8, name: 'Error' });
    expect(originalPositionFor(MAP, 1, 999)).toEqual({ source: 'src/app.ts', sourceIndex: 0, line: 2, column: 20, name: null });
  });

  it('carries the relative state across generated lines', () => {
    expect(originalPositionFor(MAP, 2, 5)).toEqual({ source: 'src/util.ts', sourceIndex: 1, line: 10, column: 4, name: null });
  });

  it('returns null before the first mapping, on an unmapped line and for a malformed map', () => {
    expect(originalPositionFor(MAP, 3, 0)).toBeNull();
    expect(originalPositionFor({ ...MAP, mappings: ';;AAAA' }, 1, 0)).toBeNull();
    expect(originalPositionFor({ ...MAP, mappings: 'AA' }, 1, 0)).toBeNull();
    expect(originalPositionFor({ ...MAP, mappings: '!!!!' }, 1, 0)).toBeNull();
    expect(originalPositionFor({ ...MAP, mappings: encodeMappings([[[5, 0, 0, 0]]]) }, 1, 2)).toBeNull();
  });

  it('returns null when the source index is out of range', () => {
    expect(originalPositionFor({ ...MAP, sources: [] }, 1, 0)).toBeNull();
  });
});

describe('parseSourceMap', () => {
  it('accepts a v3 map and rejects other versions, index maps and junk', () => {
    expect(parseSourceMap(JSON.stringify(MAP))?.mappings).toBe(MAP.mappings);
    expect(parseSourceMap(JSON.stringify({ ...MAP, version: 2 }))).toBeNull();
    expect(parseSourceMap(JSON.stringify({ version: 3, sections: [] }))).toBeNull();
    expect(parseSourceMap('{"version":3}')).toBeNull();
    expect(parseSourceMap('not json')).toBeNull();
  });
});

describe('parseFrame', () => {
  it('parses V8, Hermes and Firefox formats', () => {
    expect(parseFrame('    at onClick (https://x.test/_next/static/a.js:1:200)')).toMatchObject({ fn: 'onClick', url: 'https://x.test/_next/static/a.js', line: 1, column: 200, style: 'at' });
    expect(parseFrame('    at https://x.test/a.js:3:4')).toMatchObject({ fn: '', url: 'https://x.test/a.js', line: 3, column: 4 });
    expect(parseFrame('    at foo (address at index.android.bundle:1:2345)')).toMatchObject({ fn: 'foo', url: 'index.android.bundle', line: 1, column: 2345 });
    expect(parseFrame('    at async load (https://x.test/a.js:5:6)')).toMatchObject({ asyncPrefix: 'async ', fn: 'load' });
    expect(parseFrame('render@https://x.test/a.js:7:8')).toMatchObject({ fn: 'render', style: 'moz', line: 7, column: 8 });
  });

  it('ignores lines that are not frames', () => {
    expect(parseFrame('TypeError: x is not a function')).toBeNull();
    expect(parseFrame('    at native (native)')).toBeNull();
    expect(parseFrame('    at <anonymous>')).toBeNull();
    expect(parseFrame('    at fn (a.js:x:y)')).toBeNull();
  });
});

describe('symbolicateStack', () => {
  const load = async (url: string) => (url.endsWith('/app.js') || url === 'index.android.bundle' ? MAP : null);

  it('rewrites resolvable V8 frames and keeps the rest', async () => {
    const stack = [
      'TypeError: boom',
      '    at a (https://x.test/_next/static/app.js:1:26)',
      '    at https://x.test/vendor.js:1:5',
      '    at b (https://x.test/_next/static/app.js:2:1)',
    ].join('\n');
    expect(await symbolicateStack(stack, load)).toBe(
      ['TypeError: boom', '    at Error (src/app.ts:2:9)', '    at https://x.test/vendor.js:1:5', '    at b (src/util.ts:10:5)'].join('\n'),
    );
  });

  it('handles Firefox and Hermes frames', async () => {
    expect(await symbolicateStack('go@https://x.test/app.js:1:1', load)).toBe('fail@src/app.ts:1:1');
    expect(await symbolicateStack('Error: x\n    at f (address at index.android.bundle:1:16)', load)).toBe('Error: x\n    at f (src/app.ts:2:3)');
  });

  it('returns null when no frame resolves and never calls the loader twice for one url', async () => {
    expect(await symbolicateStack('Error: x\n    at a (https://x.test/vendor.js:1:5)', async () => null)).toBeNull();
    const calls: string[] = [];
    await symbolicateStack('    at a (https://x.test/app.js:1:1)\n    at b (https://x.test/app.js:1:15)', async (url) => {
      calls.push(url);
      return MAP;
    });
    expect(calls).toEqual(['https://x.test/app.js']);
  });
});

describe('normalizeSourcemapPath and sourcemapPathCandidates', () => {
  it('normalises upload paths and rejects traversal', () => {
    expect(normalizeSourcemapPath('_next/static/chunks/a.js')).toBe('_next/static/chunks/a.js');
    expect(normalizeSourcemapPath('https://app.test/_next/static/a.js?v=1#x')).toBe('_next/static/a.js');
    expect(normalizeSourcemapPath('/./index.android.bundle')).toBe('index.android.bundle');
    expect(normalizeSourcemapPath('../secret.js')).toBeNull();
    expect(normalizeSourcemapPath('a/../b.js')).toBeNull();
    expect(normalizeSourcemapPath('a\\b.js')).toBeNull();
    expect(normalizeSourcemapPath('')).toBeNull();
    expect(normalizeSourcemapPath('a/b\n.js')).toBeNull();
  });

  it('lists suffix candidates longest first', () => {
    expect(sourcemapPathCandidates('https://app.test/_next/static/chunks/a.js?x=1')).toEqual([
      '_next/static/chunks/a.js',
      'static/chunks/a.js',
      'chunks/a.js',
      'a.js',
    ]);
    expect(sourcemapPathCandidates('/data/user/0/app/files/index.android.bundle')[5]).toBe('index.android.bundle');
    expect(sourcemapPathCandidates('')).toEqual([]);
    expect(sourcemapPathCandidates('https://app.test/_next/static/chunks/app/%28dashboard%29/page-1.js')[0]).toBe('_next/static/chunks/app/(dashboard)/page-1.js');
    expect(sourcemapPathCandidates('https://app.test/a/%E0%A4%A/b.js')).toContain('b.js');
  });
});

describe('SourcemapStoreService and SymbolicationService', () => {
  let dir: string;
  let store: SourcemapStoreService;
  let symbolication: SymbolicationService;
  const mapText = JSON.stringify(MAP);

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'sourcemap-spec-'));
    store = new SourcemapStoreService({ get: (key: string) => (key === 'SOURCEMAP_DIR' ? dir : undefined) } as unknown as ConfigService);
    symbolication = new SymbolicationService(store);
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stores a map and finds it by a path suffix of the frame URL', async () => {
    const saved = await store.save({ platform: 'web', release: 'sha-1', path: '_next/static/chunks/app.js', mapText });
    expect(saved).toMatchObject({ replaced: false, bytes: Buffer.byteLength(mapText) });
    expect((await store.save({ platform: 'web', release: 'sha-1', path: '_next/static/chunks/app.js', mapText })).replaced).toBe(true);

    const stack = 'TypeError: x\n    at a (https://app.test/_next/static/chunks/app.js:1:26)';
    expect((await symbolication.symbolicate({ source: 'web', release: 'sha-1', stack }))?.stack).toContain('at Error (src/app.ts:2:9)');
  });

  it('does not resolve for an unknown release, another platform or a non-client source', async () => {
    await store.save({ platform: 'web', release: 'sha-1', path: 'app.js', mapText });
    const stack = 'Error: x\n    at a (https://app.test/app.js:1:26)';
    expect(await symbolication.symbolicate({ source: 'web', release: 'sha-2', stack })).toBeNull();
    expect(await symbolication.symbolicate({ source: 'mobile', release: 'sha-1', stack })).toBeNull();
    expect(await symbolication.symbolicate({ source: 'api', release: 'sha-1', stack })).toBeNull();
    expect(await symbolication.symbolicate({ source: 'web', release: 'sha-1', stack: null })).toBeNull();
  });

  it('rejects invalid maps, oversized maps and unsafe releases', async () => {
    await expect(store.save({ platform: 'web', release: 'r1', path: 'a.js', mapText: '{"version":3}' })).rejects.toBeInstanceOf(SourcemapStoreError);
    await expect(
      store.save({ platform: 'web', release: 'r1', path: 'a.js', mapText: ' '.repeat(SOURCEMAP_LIMITS.fileBytes + 1) }),
    ).rejects.toBeInstanceOf(SourcemapStoreError);
    await expect(store.save({ platform: 'web', release: '../evil', path: 'a.js', mapText })).rejects.toThrow();
    expect(await store.find('web', '../evil', ['a.js'])).toBeNull();
  });

  it('purges maps older than the retention window and removes empty release folders', async () => {
    await store.save({ platform: 'web', release: 'old', path: 'a.js', mapText });
    await store.save({ platform: 'web', release: 'new', path: 'a.js', mapText });
    const oldFile = (await fs.readdir(join(dir, 'web', 'old')))[0];
    const past = new Date(Date.now() - (SOURCEMAP_LIMITS.retentionDays + 1) * 24 * 3600 * 1000);
    await fs.utimes(join(dir, 'web', 'old', oldFile), past, past);

    expect(await store.purgeExpired(new Date())).toBe(1);
    expect(await store.find('web', 'old', ['a.js'])).toBeNull();
    expect(await store.find('web', 'new', ['a.js'])).not.toBeNull();
    await expect(fs.stat(join(dir, 'web', 'old'))).rejects.toThrow();
  });
});

describe('source context (sourcesContent)', () => {
  const APP_SOURCE = ['export function fail(msg) {', '  throw new Error(msg);', '}'].join('\n');
  const withContent: RawSourceMap = { ...MAP, sourcesContent: [APP_SOURCE, null] };
  const stack = 'Error: x\n    at a (https://app.test/app.js:1:15)\n    at b (https://app.test/app.js:2:6)';

  it('keeps sourcesContent when parsing and drops non-string entries', () => {
    const parsed = parseSourceMap(JSON.stringify({ ...MAP, sourcesContent: [APP_SOURCE, 5, null] }));
    expect(parsed?.sourcesContent).toEqual([APP_SOURCE, null, null]);
    expect(parseSourceMap(JSON.stringify(MAP))?.sourcesContent).toBeUndefined();
  });

  it('adds the lines around the resolved frame and leaves the stack text as it was', async () => {
    const plain = await symbolicateStack(stack, async () => MAP);
    const detailed = await symbolicateStackDetailed(stack, async () => withContent);
    expect(detailed?.stack).toBe(plain);
    expect(detailed?.context[0]).toEqual({
      location: 'src/app.ts:2:3',
      startLine: 1,
      lines: ['export function fail(msg) {', '  throw new Error(msg);', '}'],
      focus: 1,
    });
  });

  it('has no context when the map embeds no sources, or the source is null', async () => {
    expect((await symbolicateStackDetailed(stack, async () => MAP))?.context).toEqual([]);
    // Frame 2 maps to src/util.ts, whose content is null in the fixture.
    const utilStack = 'Error: x\n    at c (https://app.test/app.js:2:6)';
    expect((await symbolicateStackDetailed(utilStack, async () => withContent))?.context).toEqual([]);
  });

  it('never returns context for node_modules frames and caps the number of frames', async () => {
    const vendor: RawSourceMap = { ...withContent, sources: ['webpack://_N_E/./node_modules/lib/index.js', 'webpack://_N_E/./src/util.ts'] };
    expect((await symbolicateStackDetailed(stack, async () => vendor))?.context).toEqual([]);
    const many = ['Error: x', ...Array.from({ length: 8 }, () => '    at a (https://app.test/app.js:1:15)')].join('\n');
    expect((await symbolicateStackDetailed(many, async () => withContent))?.context).toHaveLength(3);
  });
});
