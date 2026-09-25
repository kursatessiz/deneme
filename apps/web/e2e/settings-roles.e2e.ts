import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';
import { uniqueSuffix } from './support/ids';

test('owner can create a role with two permissions, then delete it', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/ayarlar/roller');

  const roleName = `E2E Rol ${uniqueSuffix()}`;

  await page.getByRole('button', { name: 'Yeni rol' }).click();
  await page.getByLabel('Rol adı').fill(roleName);
  await page.getByLabel('Üye listesini ve kartını görüntüleme').check();
  await page.getByLabel('Takvimi görüntüleme').check();
  await page.getByRole('button', { name: 'Kaydet' }).click();

  const heading = page.getByRole('heading', { name: roleName, exact: true });
  await expect(heading).toBeVisible();
  // Closest ancestor div is the role card (heading's own row div is nested one level deeper).
  const card = heading.locator('xpath=ancestor::div[2]');
  await expect(card.getByText('2 izin')).toBeVisible();

  await card.getByRole('button', { name: 'Sil' }).click();
  await expect(page.getByRole('heading', { name: roleName, exact: true })).toHaveCount(0);
});
