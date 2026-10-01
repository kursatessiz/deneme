import { test, expect } from '@playwright/test';

/**
 * Page engine (G2c) public rendering, against the seeded platform site
 * (packages/database/prisma/seed.ts seedSites()): home in tr/en, a sector
 * landing page, the lead form flow, the legal draft banner, and a 404 for
 * an unpublished locale/slug. See docs/SAYFA_MOTORU.md.
 */

test.describe('platform site', () => {
  test('renders the Turkish home page with hreflang to the English variant', async ({ page }) => {
    await page.goto('/tr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const enAlternate = page.locator('link[rel="alternate"][hreflang="en"]');
    await expect(enAlternate).toHaveAttribute('href', /\/en$/);
    // x-default of the platform home page is the origin root (it redirects by locale); the page is canonical to itself.
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute('href', /^https?:\/\/[^/]+\/?$/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/tr$/);
  });

  test('the English home page carries the same hreflang set and open graph defaults', async ({ page }) => {
    await page.goto('/en');
    await expect(page.locator('link[rel="alternate"][hreflang="tr"]')).toHaveAttribute('href', /\/tr$/);
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute('href', /^https?:\/\/[^/]+\/?$/);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/(og\?|.*opengraph-image)|^https?:\/\//);
  });

  test('sitemap.xml lists one url per locale with x-default alternates', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toMatch(/<loc>[^<]*\/tr<\/loc>/);
    expect(xml).toMatch(/<loc>[^<]*\/en<\/loc>/);
    expect(xml).toContain('hreflang="x-default"');
    // The root is a redirect: it is the x-default of the home page, never a listed url of its own.
    expect(xml).not.toMatch(/<loc>https?:\/\/[^/<]+\/<\/loc>/);
    expect(xml).toMatch(/hreflang="x-default" href="https?:\/\/[^/"]+\/"/);
  });

  test('the root redirects to the home page in the visitor locale', async ({ request }) => {
    const tr = await request.get('/', { headers: { 'Accept-Language': 'tr-TR,tr;q=0.9' }, maxRedirects: 0 });
    expect(tr.status()).toBe(302);
    expect(tr.headers()['location']).toBe('/tr');
    expect(tr.headers()['vary']).toContain('Accept-Language');
    const en = await request.get('/', { headers: { 'Accept-Language': 'en-GB,en;q=0.8' }, maxRedirects: 0 });
    expect(en.headers()['location']).toBe('/en');
    const cookie = await request.get('/', { headers: { 'Accept-Language': 'tr', Cookie: 'pw_locale=en' }, maxRedirects: 0 });
    expect(cookie.headers()['location']).toBe('/en');
  });

  test('robots.txt keeps public content allowed and disallows private areas', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();
    expect(body).toContain('Allow: /');
    expect(body).toContain('Disallow: /giris/');
    expect(body).toContain('Disallow: /admin/');
    expect(body).toContain('Sitemap:');
  });

  test('renders the English home page', async ({ page }) => {
    await page.goto('/en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('renders a sector landing page in both languages at its own URL', async ({ page }) => {
    await page.goto('/tr/pilates');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pilates');

    await page.goto('/en/pilates');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pilates');
  });

  test('lead form on a sector landing page creates a lead', async ({ page }) => {
    await page.goto('/tr/pilates');
    const form = page.locator('form').first();
    await form.getByLabel('Ad soyad').fill('Test Ziyaretci');
    await form.getByLabel('Telefon').fill('+905551234567');
    await form.locator('input[type="checkbox"]').check();
    // The form drops submissions made under 1.5 s after it mounted (bot guard).
    await page.waitForTimeout(1600);

    const request = page.waitForRequest((req) => req.method() === 'POST' && /\/public\/studios\/platform\/leads$/.test(req.url()));
    await form.getByRole('button', { name: 'Gonder' }).or(form.getByRole('button', { name: 'Gönder' })).click();
    await request;
    await expect(page.getByRole('status')).toBeVisible();
  });

  test('an unapproved legal page shows the draft banner, in the page locale', async ({ page }) => {
    await page.goto('/tr/kvkk-aydinlatma-metni');
    await expect(page.getByRole('note')).toContainText('Taslak');

    await page.goto('/en/privacy-notice-tr');
    await expect(page.getByRole('note')).toContainText('Draft');
  });

  test('an unpublished locale/slug combination is a 404', async ({ page }) => {
    const response = await page.goto('/tr/this-slug-does-not-exist');
    expect(response?.status()).toBe(404);
  });
});
