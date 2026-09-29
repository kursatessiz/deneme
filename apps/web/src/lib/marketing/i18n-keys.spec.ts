import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASE_MESSAGES,
  BRAND_CHANNELS,
  BUNDLED_MESSAGES,
  CALENDAR_CHANNELS,
  CALENDAR_STATUSES,
  MARKETING_DRAFT_KINDS,
  MARKETING_DRAFT_STATUSES,
  MARKETING_STUDIO_ERROR_CODES,
} from '@platform/shared';

/**
 * The translator accepts any string key, so a typo in a screen would only
 * show up at runtime. This reads the marketing screens and checks that every
 * static `t('...')` key exists in Turkish (a plural base counts through its
 * `.one` / `.other` forms) and that the keys built from a template literal
 * exist for every value they can take.
 */

const ROOT = join(__dirname, '..', '..', 'components', 'marketing');
const catalogue = BASE_MESSAGES as Record<string, string>;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/spec|Placeholder|MarketingNav|PlatformSession/.test(name) ? [full] : [];
  });
}

const has = (key: string): boolean => key in catalogue || `${key}.one` in catalogue || `${key}.other` in catalogue;

describe('marketing screens i18n keys', () => {
  const files = sourceFiles(ROOT);

  it('finds the new screens', () => {
    const names = files.map((f) => f.split('/').pop());
    expect(names).toEqual(expect.arrayContaining(['BrandKitEditor.tsx', 'ContentCalendar.tsx', 'AiStudio.tsx', 'DraftCard.tsx']));
  });

  it('every static t() key exists in Turkish', () => {
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bt\('([A-Za-z][A-Za-z0-9_.]*)'/g)) {
        if (!has(match[1])) missing.push(`${file.split('/').pop()}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every templated key exists for each value it can take', () => {
    const expected: string[] = [
      ...['website', 'linkedin', 'instagram', 'facebook', 'x', 'youtube'].map((k) => `brandKit.links.${k}`),
      ...BRAND_CHANNELS.flatMap((c) => [`brandKit.channel.${c}`, `brandKit.senders.address.${c}`]),
      ...MARKETING_DRAFT_KINDS.map((k) => `marketingStudio.kind.${k}`),
      ...MARKETING_DRAFT_STATUSES.map((s) => `marketingStudio.status.${s}`),
      ...MARKETING_STUDIO_ERROR_CODES.map((c) => `marketingStudio.error.${c}`),
      ...['BLOCKING', 'WARNING'].map((s) => `marketingStudio.issues.severity.${s}`),
      ...[
        'BANNED_PHRASE',
        'LENGTH_EXCEEDED',
        'COUNT_OUT_OF_RANGE',
        'MISSING_DISCLAIMER',
        'EMOJI',
        'HTML',
        'UNKNOWN_PLACEHOLDER',
        'SHOUTING',
        'EXCLAMATION_OVERUSE',
        'SMS_MULTI_SEGMENT',
        'PLACEHOLDER_EDGE',
      ].map((c) => `marketingStudio.check.${c}`),
      ...['CLICK', 'CONVERSION'].map((m) => `marketingStudio.ab.metric.${m}`),
      ...['generate', 'drafts', 'segments', 'research'].map((k) => `marketingStudio.tab.${k}`),
      ...['lifecycleStage', 'countryCode', 'locale', 'firstSource', 'sourceChannel'].map((k) => `marketingStudio.segments.dimension.${k}`),
      ...['month', 'week'].map((m) => `contentCalendar.mode.${m}`),
      ...CALENDAR_STATUSES.map((s) => `contentCalendar.status.${s}`),
      ...CALENDAR_CHANNELS.map((c) => `contentCalendar.channel.${c}`),
    ];
    expect(expected.filter((k) => !has(k))).toEqual([]);
  });

  it('English has every key Turkish has in these namespaces', () => {
    const en = BUNDLED_MESSAGES.en as Record<string, string>;
    const prefixes = ['brandKit.', 'marketingStudio.', 'contentCalendar.'];
    const missing = Object.keys(catalogue).filter((k) => prefixes.some((p) => k.startsWith(p)) && !(k in en));
    expect(missing).toEqual([]);
  });

  it('no message contains an emoji', () => {
    const prefixes = ['brandKit.', 'marketingStudio.', 'contentCalendar.'];
    const offenders = Object.entries(catalogue).filter(([k, v]) => prefixes.some((p) => k.startsWith(p)) && /\p{Extended_Pictographic}/u.test(v));
    expect(offenders).toEqual([]);
  });
});
