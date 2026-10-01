import { test, expect } from '@playwright/test';

/**
 * Public booking page (`/booking/<studioSlug>/book`) against the seeded demo
 * studio (packages/database/prisma/seed.ts, `zen-reformer-pilates`): the
 * studio name and its service types come from the public embed endpoints,
 * and the language switch re-renders the page text. The page never creates
 * a booking itself (docs/PUBLIC_API.md), so nothing is submitted here.
 */

const PAGE = '/booking/zen-reformer-pilates/book';

test.describe('public booking page', () => {
  test('shows the studio name and its service types, and switches language', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zen Reformer Pilates');
    await expect(page.getByText('Hizmet', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Birebir Reformer/ }).first()).toBeVisible();

    await page.getByLabel('Dil').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByText('Service', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zen Reformer Pilates');
    await expect(page.getByRole('button', { name: /Birebir Reformer/ }).first()).toBeVisible();
  });

  test.describe('English browser', () => {
    test.use({ locale: 'en-US' });

    test('an English browser gets the English page text', async ({ page }) => {
      await page.goto(PAGE);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByText('Choose a service and a time that works for you.')).toBeVisible();
    });
  });

  test('an unknown studio shows the load error instead of sample data', async ({ page }) => {
    await page.goto('/booking/no-such-studio-slug/book');
    await expect(page.getByText('Bilgiler yüklenemedi')).toBeVisible();
  });
});
