import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD, LOGINS, loginAs } from './support/login';

/**
 * M1 marketing panel shell (/pazarlama, docs/PAZARLAMA_MODULU.md 3): the
 * super admin opens it from AdminNav, the reused tenant screens run on the
 * platform tenant with links kept under /pazarlama, and the integrations
 * hub is the same component at /admin/entegrasyonlar. A tenant owner has no
 * platform access and never reaches it; their own links are unchanged.
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

test('super admin opens the marketing panel and the reused screens stay under /pazarlama', async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto('/admin/tenants');
  await page.getByRole('link', { name: 'Pazarlama', exact: true }).click();
  await page.waitForURL('**/pazarlama');

  const nav = page.getByRole('navigation', { name: 'Pazarlama paneli' });
  for (const label of ['Pano', 'Kişiler', 'Segmentler', 'Kampanyalar', 'Akışlar', 'Gelen kutusu', 'Reklam', 'Entegrasyonlar', 'Marka kiti']) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('main').getByText('Bu bölüm sonraki fazda eklenecek.')).toBeVisible();

  await nav.getByRole('link', { name: 'Kişiler', exact: true }).click();
  await page.waitForURL('**/pazarlama/kisiler');
  const pipeline = page.getByRole('main').getByRole('link', { name: 'Satış hattı panosu', exact: true });
  if (await pipeline.count()) await expect(pipeline).toHaveAttribute('href', '/pazarlama/kisiler/satis-hatti');

  await nav.getByRole('link', { name: 'Segmentler', exact: true }).click();
  await page.waitForURL('**/pazarlama/segmentler');
  const newSegment = page.getByRole('main').getByRole('link', { name: 'Yeni segment' });
  if (await newSegment.count()) await expect(newSegment.first()).toHaveAttribute('href', '/pazarlama/segmentler/yeni');
});

test('the integrations hub is the same component from both entry points', async ({ page }) => {
  await loginAsSuperAdmin(page);
  for (const url of ['/admin/entegrasyonlar', '/pazarlama/entegrasyonlar']) {
    await page.goto(url);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Entegrasyonlar' }).first()).toBeVisible();
    await expect(main.getByText('E-posta gönderen alan adları')).toBeVisible();
    await expect(main.getByText('Reklam bağlantıları')).toBeVisible();
  }
  // Platform-only cards are for the super admin console.
  await page.goto('/admin/entegrasyonlar');
  await expect(page.getByRole('main').getByText('Platform ayarları (yalnızca süper admin)')).toBeVisible();
});

test('a tenant owner has no marketing panel and keeps the tenant links', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/pazarlama');
  await page.waitForURL('**/dashboard');

  await page.goto('/segmentler');
  const newSegment = page.getByRole('main').getByRole('link', { name: 'Yeni segment' });
  if (await newSegment.count()) await expect(newSegment.first()).toHaveAttribute('href', '/segmentler/yeni');

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/giris/);
});
