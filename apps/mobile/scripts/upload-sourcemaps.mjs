#!/usr/bin/env node
// Uploads the source maps of a mobile JS bundle to the API (docs/HATA_RAPORLAMA.md, docs/MOBILE_APP.md).
//
// Plain Node (.mjs) on purpose: Node 22 runs it without a TypeScript runner
// and the workspace has no ts-node/tsx. Run it after `expo export`:
//
//   npx expo export --platform android --platform ios --source-maps --output-dir dist
//   SOURCEMAP_UPLOAD_TOKEN=... API_URL=https://api.example.com \
//     node apps/mobile/scripts/upload-sourcemaps.mjs --dist apps/mobile/dist --update-id <eas update id>
//
// The release is the app version (app.json) plus, for an EAS Update, the
// update id: `<version>-<update id>`, the same value the app reports as its
// `release` (mobileRelease in packages/shared/src/sourcemaps.ts). For the
// bundle embedded in a store build, omit --update-id and pass the maps that
// the EAS build produced with --dist (the release is then just the version).
// Maps are stored under the bundle file name only (index.android.bundle,
// entry-<hash>.hbc, ...); the API matches a frame by the longest path suffix
// that has a stored map, so the device's directory does not matter.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadDirectory } from '../../../deploy/scripts/upload-sourcemaps.mjs';

const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Keep in sync with mobileRelease() in packages/shared/src/sourcemaps.ts. */
export function releaseOf(version, updateId) {
  const combined = updateId ? `${version}-${updateId}` : version;
  if (RELEASE_PATTERN.test(combined)) return combined;
  throw new Error(`"${combined}" is not a valid release (letters, digits, dot, dash, underscore; at most 64 characters)`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad arguments near ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.SOURCEMAP_UPLOAD_TOKEN ?? '';
  const apiUrl = args['api-url'] ?? process.env.API_URL ?? '';
  if (!token) throw new Error('SOURCEMAP_UPLOAD_TOKEN is not set');
  if (!apiUrl) throw new Error('give --api-url or set API_URL');
  if (!args.dist) throw new Error('--dist (the expo export output directory) is required');
  const here = dirname(fileURLToPath(import.meta.url));
  const version = args.version ?? JSON.parse(await readFile(join(here, '..', 'app.json'), 'utf8')).expo.version;
  const release = releaseOf(version, args['update-id']);
  const result = await uploadDirectory({ apiUrl, token, release, platform: 'mobile', dir: args.dist, flatten: true });
  console.log(`mobile source maps for ${release}: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.failed} failed`);
  if (result.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
