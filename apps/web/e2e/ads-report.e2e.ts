import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

/**
 * G2b "Reklam performansı" screen: date range, model and groupBy
 * selectors, and the totals row rendering without crashing even with no
 * connected ad account (every number reads as "—" rather than throwing).
 */
test('owner can open the ad performance report and change model/groupBy', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/reklam-performansi');

  await expect(page.getByRole('heading', { name: 'Reklam performansı' })).toBeVisible();
  await expect(page.getByText('Toplam')).toBeVisible();

  // Switch attribution model.
  await page.locator('select').first().selectOption('FIRST_TOUCH');
  // Switch grouping to campaign.
  const groupBySelect = page.locator('select').nth(1);
  await groupBySelect.selectOption('campaign');
  await expect(page.getByText('Etiketsiz ücretli trafik')).toBeVisible();
});

test('reception without ads.view sees the forbidden state', async ({ page }) => {
  await loginAs(page, LOGINS.reception);
  await page.goto('/reklam-performansi');
  // PageGuard renders the shared Forbidden view for a missing permission.
  await expect(page.getByText(/yetki|izin/i)).toBeVisible();
});
