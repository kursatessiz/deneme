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

  const marketInput = page.getByLabel('Pazar (ör. tr, us, de)');
  await marketInput.fill('tr');
  const langInput = page.getByLabel('Dil');
  await langInput.fill('tr');
  const sectorInput = page.getByLabel('Sektör');
  await sectorInput.fill('pilates');
  const monthInput = page.getByLabel('Ay');
  await monthInput.fill('202610');

  await expect(page.locator('code').first()).toHaveText('tr_tr_pilates_lead_202610');

  // Switch platform to Google and check the url params template changes.
  // Select order on the page: [0] connection platform, [1] UTM objective,
  // [2] UTM platform.
  const selects = page.locator('select');
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
