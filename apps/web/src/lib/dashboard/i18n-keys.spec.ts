import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLED_MESSAGES, DASHBOARD_PERIODS, DASHBOARD_WIDGETS, DASHBOARD_WIDGET_CATEGORIES } from '@platform/shared';

/**
 * Every literal message key the overview board uses, and every key the
 * card catalogue builds, exists in Turkish and English (a missing key
 * would show raw text to the user).
 */

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') || path.endsWith('.ts') ? [path] : [];
  });
}

const ROOTS = [join(__dirname, '..', '..', 'components', 'dashboard'), __dirname].filter((dir) => !dir.endsWith('.spec.ts'));
const KEY = /'((?:dashboard|screens\.dashboard|retail\.lowStock|churn\.level|finance\.method)\.[a-zA-Z0-9_.]+)'/g;

function has(locale: 'tr' | 'en', key: string): boolean {
  const messages = BUNDLED_MESSAGES[locale];
  return key in messages || `${key}.other` in messages;
}

describe('overview board messages', () => {
  it('has every literal key in tr and en', () => {
    const keys = new Set<string>();
    for (const file of ROOTS.flatMap(files)) {
      if (file.endsWith('.spec.ts')) continue;
      for (const match of readFileSync(file, 'utf8').matchAll(KEY)) keys.add(match[1]);
    }
    expect(keys.size).toBeGreaterThan(50);
    const missing = [...keys].filter((key) => !has('tr', key) || !has('en', key));
    expect(missing).toEqual([]);
  });

  it('has every catalogue, category, period and payment status key', () => {
    const keys = [
      ...DASHBOARD_WIDGETS.flatMap((w) => [w.titleKey, w.descriptionKey]),
      ...DASHBOARD_WIDGET_CATEGORIES.map((c) => `dashboard.category.${c}`),
      ...DASHBOARD_PERIODS.map((p) => `dashboard.period.${p}`),
      ...['PENDING', 'COMPLETED', 'REFUNDED', 'FAILED'].map((s) => `dashboard.paymentStatus.${s}`),
    ];
    const missing = keys.filter((key) => !has('tr', key) || !has('en', key));
    expect(missing).toEqual([]);
  });
});
