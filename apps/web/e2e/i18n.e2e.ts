import { test, expect } from '@playwright/test';

test.describe('Language selection', () => {
  test.describe('English browser', () => {
    test.use({ locale: 'en-US' });

    test('an English browser gets the English login page', async ({ page }) => {
      await page.goto('/giris');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    });
  });

  test('a Turkish browser gets the Turkish login page', async ({ page }) => {
    await page.goto('/giris');
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('button', { name: 'Giriş yap', exact: true })).toBeVisible();
  });
});
