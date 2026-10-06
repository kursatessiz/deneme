#!/usr/bin/env node
// i18n regression guard (docs/I18N.md, "Regresyon korumasi"). Fails when apps/web/apps/mobile source contains:
//  - a Turkish-character string literal or JSX text outside messages/ (user-visible copy must come from i18n keys),
//  - window.confirm/alert/prompt in apps/web/src (use useConfirm()/useToast() from components/ui),
//  - Alert.alert without a buttons array in apps/mobile (the OS-default "OK" ignores the app language).
// Usage: node scripts/check-i18n.mjs            scan the repository
//        node scripts/check-i18n.mjs --stdin <web|mobile> <file name>   scan source from stdin, print JSON (used by the unit test)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource } from './i18n-scan-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = [
  { dir: 'apps/web/src', platform: 'web' },
  { dir: 'apps/mobile/app', platform: 'mobile' },
  { dir: 'apps/mobile/src', platform: 'mobile' },
];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'messages', '.expo']);
const SKIP_FILE = /(\.(spec|test|e2e)\.tsx?|\.d\.ts)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !SKIP_FILE.test(name)) out.push(full);
  }
  return out;
}

if (process.argv[2] === '--stdin') {
  const [, , , platform, fileName] = process.argv;
  console.log(JSON.stringify(scanSource(fileName, readFileSync(0, 'utf8'), { platform })));
  process.exit(0);
}

const allowlist = JSON.parse(readFileSync(join(ROOT, 'scripts/i18n-guard-allowlist.json'), 'utf8')).entries;
const isAllowed = (file, f) => allowlist.some((e) => e.file === file && e.kind === f.kind && f.text.includes(e.contains));

const failures = [];
for (const { dir, platform } of TARGETS) {
  for (const file of walk(join(ROOT, dir))) {
    const text = readFileSync(file, 'utf8');
    // Cheap pre-filter: only parse files that can possibly produce a finding.
    if (!/[çğıöşüÇĞİÖŞÜ]|confirm|alert|prompt|Alert/.test(text)) continue;
    const rel = relative(ROOT, file).split(sep).join('/');
    for (const f of scanSource(file, text, { platform })) {
      if (!isAllowed(rel, f)) failures.push(`${rel}:${f.line} [${f.kind}] ${f.text}`);
    }
  }
}

if (failures.length > 0) {
  console.error('i18n guard failed. User-visible text must come from i18n keys and dialogs from the in-app UI (docs/I18N.md):\n');
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log('i18n guard passed.');
