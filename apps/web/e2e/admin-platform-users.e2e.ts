import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './support/login';

/**
 * M1 "Platform kullanıcıları" (docs/PAZARLAMA_MODULU.md 2.6): the super
 * admin invites a marketing admin by phone, sees the invite link and the
 * INVITED row, deactivates it again, and finds the 2FA policy switch. The
 * seeded super admin has no 2FA yet, so sign-in goes through the
 * enrolment reminder (grace) and /admin stays reachable.
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

/** +90 537 plus seven digits from the clock: unique per run, outside the seeded ranges. */
function uniquePhone(): string {
  return `+90537${Date.now().toString().slice(-7)}`;
}

test('super admin invites a marketing admin, sees the invite, then deactivates them', async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto('/admin/platform-kullanicilari');

  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Platform kullanıcıları' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pazarlama', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Entegrasyonlar', exact: true })).toBeVisible();

  const fullName = `E2E Pazarlama ${Date.now().toString(36)}`;
  await main.getByLabel('Ad soyad', { exact: true }).fill(fullName);
  await main.getByLabel('Telefon', { exact: true }).fill(uniquePhone());
  await main.getByRole('button', { name: 'Davet oluştur' }).click();

  await expect(main.getByText(/Davet oluşturuldu/)).toBeVisible();
  await expect(main.locator('code').filter({ hasText: '/j/' })).toBeVisible();

  const row = main.getByRole('row').filter({ hasText: fullName });
  await expect(row.getByText('Davet edildi')).toBeVisible();
  await row.getByRole('button', { name: 'Pasifleştir' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Onayla', exact: true }).click();
  await expect(row.getByText('Pasif', { exact: true })).toBeVisible();

  await expect(main.getByRole('switch')).toBeVisible();
  await expect(main.getByText('Platform rolleri için iki adımlı doğrulama zorunlu')).toBeVisible();
});

test('the super admin without 2FA is sent to enrolment at sign-in but not locked out of /admin', async ({ page }) => {
  await loginAsSuperAdmin(page);
  await expect(page).toHaveURL(/\/guvenlik\/iki-adim/);
  await expect(page.getByRole('main').getByRole('button', { name: 'Kurulumu başlat' })).toBeVisible();

  await page.goto('/admin/tenants');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kurulumu başlat' })).toBeVisible();
});
