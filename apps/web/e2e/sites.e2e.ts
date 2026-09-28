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
