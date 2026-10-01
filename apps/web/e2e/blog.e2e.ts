import { test, expect } from '@playwright/test';

/**
 * Blog articles on the page engine (S2b), against the seeded data
 * (packages/database/prisma/seed.ts seedArticles()): two published platform
 * articles in tr and en tagged "rehber", a platform draft that must 404, and
 * one published article on Zen's tenant site. See docs/SAYFA_MOTORU.md and docs/SEO.md.
 */

const TR_TITLE = 'Randevu iptallerini azaltmanın beş yolu';
const TR_SLUG = 'randevu-iptallerini-azaltmanin-yollari';
const EN_SLUG = 'ways-to-reduce-booking-cancellations';
const TENANT_HOST = 'zen-reformer-pilates.localhost:3000';
const TENANT_TITLE = 'Reformer ile ilk dersiniz';

test.describe('platform blog', () => {
  test('lists published articles with an RSS alternate link and hreflang', async ({ page }) => {
    await page.goto('/tr/blog');
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Blog');
    await expect(page.getByTestId('blog-article-card').filter({ hasText: TR_TITLE })).toHaveCount(1);
    await expect(page.getByText('Taslak yazı')).toHaveCount(0);
    await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveAttribute('href', /\/tr\/blog\/rss\.xml$/);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', /\/en\/blog$/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/tr\/blog$/);
  });

  test('renders an article with Article and BreadcrumbList JSON-LD, hreflang and canonical', async ({ page }) => {
    await page.goto('/tr/blog');
    await page.getByRole('link', { name: TR_TITLE }).click();
    await expect(page).toHaveURL(new RegExp(`/tr/blog/${TR_SLUG}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TR_TITLE);
    await expect(page.getByRole('heading', { level: 2, name: 'Net bir iptal politikası yazın' })).toBeVisible();
    // Markup subset: an https link opens safely, bold renders as strong.
    const link = page.getByTestId('article-body').getByRole('link', { name: 'yardım merkezimize' });
    await expect(link).toHaveAttribute('href', 'https://example.com/yardim');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(page.getByTestId('article-body').locator('strong')).toHaveText('rezervasyon anında');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/tr/blog/${TR_SLUG}$`));
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', new RegExp(`/en/blog/${EN_SLUG}$`));
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute('href', new RegExp(`/tr/blog/${TR_SLUG}$`));
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
    await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveCount(1);

    const docs = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((d) => JSON.parse(d) as Record<string, unknown>);
    const article = docs.find((d) => d['@type'] === 'Article');
    expect(article).toMatchObject({ headline: TR_TITLE, inLanguage: 'tr', datePublished: '2026-09-15T08:00:00.000Z' });
    expect(article?.publisher).toMatchObject({ '@type': 'Organization' });
    expect(article?.author).toMatchObject({ name: 'Platform Ekibi' });
    expect(article?.mainEntityOfPage).toMatchObject({ '@type': 'WebPage' });
    expect(docs.find((d) => d['@type'] === 'BreadcrumbList')).toBeDefined();
  });

  test('renders the English variant and the tag listing', async ({ page }) => {
    await page.goto(`/en/blog/${EN_SLUG}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Five ways to reduce booking cancellations');

    await page.goto('/tr/blog/tag/rehber');
    await expect(page.getByTestId('blog-article-card')).toHaveCount(2);
  });

  test('an unpublished article and an unknown tag are 404', async ({ request }) => {
    expect((await request.get('/tr/blog/taslak-yazi')).status()).toBe(404);
    expect((await request.get('/tr/blog/tag/no-such-tag')).status()).toBe(404);
  });

  test('serves an RSS 2.0 feed and lists articles in sitemap.xml', async ({ request }) => {
    const feed = await request.get('/tr/blog/rss.xml');
    expect(feed.status()).toBe(200);
    expect(feed.headers()['content-type']).toContain('application/rss+xml');
    const xml = await feed.text();
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain(`<title>${TR_TITLE}</title>`);
    expect(xml).not.toContain('taslak-yazi');

    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toMatch(new RegExp(`<loc>[^<]*/tr/blog/${TR_SLUG}</loc>`));
    expect(sitemap).toMatch(new RegExp(`hreflang="en" href="[^"]*/en/blog/${EN_SLUG}"`));
    expect(sitemap).toMatch(/<loc>[^<]*\/tr\/blog<\/loc>/);
  });
});

test.describe('tenant blog', () => {
  test('renders on the tenant host path', async ({ request, page }) => {
    // The middleware rewrites `<slug>.<base domain>` to the tenant-site tree.
    const res = await request.get('/tr/blog', { headers: { Host: TENANT_HOST } });
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain(TENANT_TITLE);

    await page.goto('/tenant-site/zen-reformer-pilates/tr/blog/reformer-ile-ilk-dersiniz');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TENANT_TITLE);
    const docs = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((d) => JSON.parse(d) as Record<string, unknown>);
    expect(docs.find((d) => d['@type'] === 'Article')).toMatchObject({ publisher: { name: 'Zen Reformer Pilates' } });
  });
});
