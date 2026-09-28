import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

/**
 * G2b "Reklam performansı" screen: date range, model and groupBy
 * selectors. The seed has no ad data, so the report shows either the
 * totals row or the empty state; both mean it rendered without crashing.
 */
test('owner can open the ad performance report and change model/groupBy', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/reklam-performansi');

  await expect(page.getByRole('heading', { name: 'Reklam performansı' })).toBeVisible();
  const rendered = () => page.getByText('Toplam', { exact: true }).or(page.getByText('Seçilen aralıkta veri yok'));
  await expect(rendered()).toBeVisible();

  // Switch attribution model.
  await page.getByRole('main').locator('select').first().selectOption('FIRST_TOUCH');
  // Switch grouping to campaign.
  const groupBySelect = page.getByRole('main').locator('select').nth(1);
  await groupBySelect.selectOption('campaign');
  await expect(groupBySelect).toHaveValue('campaign');
  await expect(rendered()).toBeVisible();
});

test('reception without ads.view sees the forbidden state', async ({ page }) => {
  await loginAs(page, LOGINS.reception);
  await page.goto('/reklam-performansi');
  // PageGuard renders the shared Forbidden view for a missing permission.
  await expect(page.getByText(/yetki|izin/i)).toBeVisible();
});
