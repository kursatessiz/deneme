import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';
import { uniqueSuffix } from './support/ids';

/**
 * G2a CRM screens (docs/WEB_PANEL.md, "Kişiler"): the contact list with
 * search, the contact card (details, consent, timeline with a new note),
 * and the pipeline board. Uses the seeded open lead (+905399960001, the
 * same contact the API crm-migration suite asserts on).
 */

const SEEDED_LEAD_PHONE = '+905399960001';

test('reception finds a contact, opens the card and adds a note', async ({ page }) => {
  await loginAs(page, LOGINS.reception);
  await page.locator('nav').getByText('Kişiler', { exact: true }).click();
  await page.waitForURL('**/kisiler');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Kişiler', exact: true })).toBeVisible();

  await main.getByLabel('Ad, telefon veya e-posta ara').fill(SEEDED_LEAD_PHONE);
  const table = main.getByRole('table', { name: 'Kişiler' });
  const row = table.getByRole('row').filter({ hasText: SEEDED_LEAD_PHONE });
  await expect(row).toHaveCount(1);
  await row.getByRole('link').first().click();
  await page.waitForURL(/\/kisiler\/[0-9a-f-]{36}$/);

  await expect(main.getByRole('heading', { name: 'Bilgiler' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Ticari mesaj izni' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Atıf özeti' })).toBeVisible();

  const note = `E2E not ${uniqueSuffix()}`;
  await main.getByLabel('Not', { exact: true }).fill(note);
  await main.getByRole('button', { name: 'Not ekle' }).click();
  await expect(main.getByRole('list', { name: 'Etkinlik geçmişi' }).getByText(note)).toBeVisible();
});

test('the pipeline board shows the stages as columns', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/kisiler/satis-hatti');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Satış hattı', exact: true })).toBeVisible();
  await expect(main.getByRole('region', { name: 'Yeni' })).toBeVisible();
  await expect(main.getByRole('region', { name: 'Kazanıldı' })).toBeVisible();
});

test('a trainer has no contacts entry and gets the 403 view', async ({ page }) => {
  await loginAs(page, LOGINS.trainer);
  await expect(page.locator('nav').getByText('Kişiler', { exact: true })).toHaveCount(0);
  await page.goto('/kisiler');
  await expect(page.getByText('Bu sayfayı görüntüleme yetkiniz yok')).toBeVisible();
});
