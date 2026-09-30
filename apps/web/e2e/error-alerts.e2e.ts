import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './support/login';

/**
 * H3 error alert screens (docs/HATA_RAPORLAMA.md): the super admin opens the
 * alert list and the alert settings. Written to be type-checked; it needs the
 * seeded demo data like the other admin specs.
 */

const SUPER_ADMIN_PHONE = '+905321000001';

async function loginAsSuperAdmin(page: Page): Promise<void> {
  await page.goto('/giris');
  const form = page.locator('form').first();
  await form.locator('input:not([type="password"])').first().fill(SUPER_ADMIN_PHONE);
  await form.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/giris'));
}

test('the super admin sees the alert list and the alert settings', async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto('/admin/hatalar/uyarilar');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Hata uyarıları' })).toBeVisible();

  await page.goto('/admin/hatalar/ayarlar');
  await expect(main.getByRole('heading', { name: 'Uyarı ayarları' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Ani artış tespiti' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'İmzalı webhook' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Slack' })).toBeVisible();
});
