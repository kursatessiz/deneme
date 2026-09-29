import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD, LOGINS, loginAs } from './support/login';

/**
 * D2 backups console (docs/YEDEKLER.md). The e2e API runs without an
 * off-site store, so the page shows the "not configured" state, keeps
 * "Back up now" disabled and still lets the super admin edit the schedule
 * and retention. The system health page shows the backup card. A tenant
 * owner never reaches the screen.
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

test('the super admin sees the backup console and edits the schedule', async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto('/admin/yedekler');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Yedekler', exact: true })).toBeVisible();
  await expect(main.getByText('Uzak yedek deposu veya şifreleme anahtarı tanımlı değil.', { exact: false })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Şimdi yedek al' })).toBeDisabled();
  await expect(main.getByRole('heading', { name: 'Son başarılı yedek' })).toBeVisible();

  const settings = main.getByRole('form', { name: 'Zamanlama ve saklama' });
  const retention = settings.getByRole('spinbutton', { name: 'Saklama süresi (gün, 0 = kapalı)' });
  await retention.fill('30');
  await settings.getByRole('button', { name: 'Kaydet' }).click();
  await expect(main.getByRole('status')).toHaveText('Ayarlar kaydedildi.');
  await expect(main.getByText('30 gün', { exact: true })).toBeVisible();

  // Put the default back so the suite can run again.
  await retention.fill('35');
  await settings.getByRole('button', { name: 'Kaydet' }).click();
  await expect(main.getByText('35 gün', { exact: true })).toBeVisible();

  await page.goto('/admin/health');
  await expect(main.getByRole('heading', { name: 'Veritabanı Yedekleri' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Yedekleri aç' })).toHaveAttribute('href', '/admin/yedekler');
});

test('a tenant owner cannot open the backup console', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/admin/yedekler');
  await page.waitForURL((url) => !url.pathname.startsWith('/admin'));
  expect(new URL(page.url()).pathname.startsWith('/admin')).toBe(false);
});
