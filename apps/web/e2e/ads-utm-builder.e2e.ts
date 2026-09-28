import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

/**
 * G2b UTM builder (docs/BUYUME_VE_GLOBAL_MIMARI.md section 4): the
 * generated campaign name follows buildCampaignName's pattern and the URL
 * parameters match AD_URL_TEMPLATES for the selected platform.
 */
test('owner builds a campaign name and copies the URL parameters', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/ayarlar/reklam');

  await expect(page.getByText('UTM oluşturucu')).toBeVisible();
  const main = page.getByRole('main');

  const marketInput = main.getByLabel('Pazar (ör. tr, us, de)', { exact: true });
  await marketInput.fill('tr');
  const langInput = main.getByRole('textbox', { name: 'Dil', exact: true });
  await langInput.fill('tr');
  const sectorInput = main.getByLabel('Sektör', { exact: true });
  await sectorInput.fill('pilates');
  const monthInput = main.getByLabel('Ay', { exact: true });
  await monthInput.fill('202610');

  await expect(page.locator('code').first()).toHaveText('tr_tr_pilates_lead_202610');

  // Switch platform to Google and check the url params template changes.
  // Select order on the page: [0] connection platform, [1] UTM objective,
  // [2] UTM platform.
  const selects = main.locator('select');
  await selects.nth(2).selectOption('GOOGLE');
  await expect(page.getByText(/utm_source=google&utm_medium=cpc/)).toBeVisible();
});

test('the connections form rejects an incomplete submission', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/ayarlar/reklam');
  await expect(page.getByText('Reklam platformu bağlantıları')).toBeVisible();
  await page.getByRole('button', { name: 'Bağlantı ekle' }).click();
  await expect(page.getByText('Bağlantı kaydedilemedi')).toBeVisible();
});
