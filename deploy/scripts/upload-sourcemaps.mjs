#!/usr/bin/env node
// Uploads source maps to the API's symbolication store (docs/HATA_RAPORLAMA.md, H2).
//
//   SOURCEMAP_UPLOAD_TOKEN=... node deploy/scripts/upload-sourcemaps.mjs \
//     --api-url https://api.example.com --release sha-<commit> --platform web \
//     --dir ./sourcemaps/static --path-prefix _next/static/
//
// Every *.map file under --dir is sent to POST /admin/errors/sourcemaps. The
// bundle path the API stores is --path-prefix plus the map's path relative to
// --dir, without the ".map" suffix: it must equal the URL path (web) or the
// file name (mobile) that appears in stack frames. Plain Node 22, no
// dependencies. Failures print warnings and exit 1; the CI step marks itself
// continue-on-error, because missing maps only degrade stack traces.

import { open, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Same limits as SOURCEMAP_LIMITS in packages/shared/src/sourcemaps.ts. */
export const MAX_MAP_BYTES = 10 * 1024 * 1024;
const RETRIES = 3;

/** All *.map files under `dir` (relative POSIX paths), sorted. */
export async function collectMaps(dir) {
  const found = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.map')) found.push(relative(dir, full).split(sep).join('/'));
    }
  };
  await walk(dir);
  return found.sort();
}

/** The bundle path a map is stored under: prefix + relative path without ".map". */
export function bundlePathFor(relativePath, pathPrefix = '') {
  return `${pathPrefix}${relativePath.replace(/\.map$/, '')}`;
}

async function post(url, token, payload) {
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sourcemap-token': token },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { ok: true };
      lastError = `HTTP ${res.status}`;
      // A client error will not get better by retrying.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return { ok: false, error: lastError };
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'network error';
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  return { ok: false, error: lastError };
}

/**
 * Uploads every map under `dir`. Returns { uploaded, skipped, failed }.
 * Maps over the size limit are skipped with a warning. With `flatten`, only
 * the map's file name is used as the bundle path (mobile: device frames carry
 * an unpredictable directory).
 */
export async function uploadDirectory({ apiUrl, token, release, platform, dir, pathPrefix = '', flatten = false, log = console }) {
  const files = await collectMaps(dir);
  const endpoint = `${apiUrl.replace(/\/+$/, '')}/admin/errors/sourcemaps`;
  const result = { uploaded: 0, skipped: 0, failed: 0 };
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++];
      const full = join(dir, ...file.split('/'));
      // One handle for the size check and the read, so the file cannot change in between.
      const handle = await open(full, 'r');
      let map;
      try {
        const size = (await handle.stat()).size;
        if (size > MAX_MAP_BYTES) {
          log.warn(`skipped ${file}: ${size} bytes is over the ${MAX_MAP_BYTES} byte limit`);
          result.skipped++;
          continue;
        }
        map = await handle.readFile('utf8');
      } finally {
        await handle.close();
      }
      const outcome = await post(endpoint, token, { release, platform, path: bundlePathFor(flatten ? file.slice(file.lastIndexOf('/') + 1) : file, pathPrefix), map });
      if (outcome.ok) result.uploaded++;
      else {
        log.warn(`failed ${file}: ${outcome.error}`);
        result.failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return result;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`unexpected argument ${flag}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    args[flag.slice(2)] = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.SOURCEMAP_UPLOAD_TOKEN ?? '';
  for (const required of ['api-url', 'release', 'platform', 'dir']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  if (!token) throw new Error('SOURCEMAP_UPLOAD_TOKEN is not set');
  if (args.platform !== 'web' && args.platform !== 'mobile') throw new Error('--platform must be web or mobile');
  const result = await uploadDirectory({
    apiUrl: args['api-url'],
    token,
    release: args.release,
    platform: args.platform,
    dir: args.dir,
    pathPrefix: args['path-prefix'] ?? '',
  });
  console.log(`source maps for ${args.release} (${args.platform}): ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.failed} failed`);
  if (result.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
