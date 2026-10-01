import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tenantRewritePath } from './tenant-path';

/**
 * Guards of the ISR setup for the page engine (docs/SEO.md "ISR"): every cached route declares its revalidation
 * window, never reads request-scoped data, and a tenant route always carries the studio slug as a route param,
 * which is the cache key that keeps two tenants' pages apart whatever host served them.
 */

const APP_DIR = join(__dirname, '..', '..', 'app');

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pageFiles(full));
    else if (name === 'page.tsx') out.push(full);
  }
  return out;
}

const platformPages = pageFiles(join(APP_DIR, '[locale]'));
const tenantPages = pageFiles(join(APP_DIR, 'tenant-site'));
/** Source without comments: the guards look at code, not at prose that mentions these names. */
function code(file: string): string {
  return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const isDynamicTwin = (file: string) => file.includes('%5Fdynamic');

describe('ISR page engine routes', () => {
  it('finds the page engine routes', () => {
    expect(platformPages.length).toBeGreaterThanOrEqual(7);
    expect(tenantPages.length).toBeGreaterThanOrEqual(7);
  });

  it.each([...platformPages, ...tenantPages].filter((f) => !isDynamicTwin(f)).map((f) => [relative(APP_DIR, f), f]))('%s is cached and request-independent', (_name, file) => {
    const source = code(file);
    expect(source).toMatch(/export const revalidate = 300;/);
    expect(source).not.toMatch(/force-dynamic/);
    expect(source).not.toMatch(/searchParams|next\/headers|cookies\(|headers\(/);
    expect(source).toMatch(/generateStaticParams/);
  });

  it.each([...platformPages, ...tenantPages].filter(isDynamicTwin).map((f) => [relative(APP_DIR, f), f]))('%s (A/B twin) renders per request', (_name, file) => {
    expect(code(file)).toMatch(/export const dynamic = 'force-dynamic';/);
  });

  it('keys every tenant route by the studio slug', () => {
    for (const file of tenantPages) expect(relative(APP_DIR, file)).toContain('[studioSlug]');
  });

  it('rewrites two tenants to two different cache paths, so one host can never see the other', () => {
    const a = tenantRewritePath('zen-studio', '/tr/blog');
    const b = tenantRewritePath('flow-studio', '/tr/blog');
    expect(a).not.toBe(b);
    expect(a).toBe('/tenant-site/zen-studio/tr/blog');
  });

  it('keeps cookies and headers out of the shared page components', () => {
    for (const name of ['SitePage.tsx', 'BlogPages.tsx', 'SiteShell.tsx', 'BlockRenderer.tsx']) {
      const source = code(join(__dirname, '..', '..', 'components', 'sites', name));
      expect(source).not.toMatch(/from 'next\/headers'|requestSiteOrigin/);
    }
  });
});
