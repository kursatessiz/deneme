import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD, LOGINS, loginAs } from './support/login';

/**
 * G5c-2 add-on marketplace (docs/UYGULAMA_PAZARI.md). The super admin sees
 * the seeded catalogue with per-currency prices and the revenue block; the
 * owner of a seeded business opens /ayarlar/uygulamalar, sees the cards with
 * the price in the billing currency and starts a free trial. Reception has
 * no access. The trial changes seed state, so the suite runs serially and CI
 * runs it once per freshly seeded database.
 */

test.use({ actionTimeout: 15_000 });
test.describe.configure({ mode: 'serial' });

const SUPER_ADMIN_PHONE = '+905321000001';

async function loginAsSuperAdmin(page: Page): Promise<void> {
  await page.goto('/giris');
  const form = page.locator('form').first();
  await form.locator('input:not([type="password"])').first().fill(SUPER_ADMIN_PHONE);
  await form.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/giris'));
}

test('the super admin sees the catalogue, prices per currency and the revenue block', async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto('/admin/uygulama-pazari');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Uygulama pazarı', exact: true }).first()).toBeVisible();
  const card = main.getByTestId('admin-add-on-video-library');
  await expect(card.getByText('Yayında', { exact: true })).toBeVisible();
  await expect(card.getByText(/Açtığı özellik: video_content/)).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Uygulama geliri', exact: true })).toBeVisible();
});

test('the super admin opens the editor with per-locale text and price fields', async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto('/admin/uygulama-pazari');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Yeni uygulama', exact: true }).click();
  const form = main.getByRole('form', { name: 'Yeni uygulama', exact: true });
  await expect(form.getByLabel('Ad (tr)')).toBeVisible();
  await expect(form.getByLabel('Ad (en)')).toBeVisible();
  await expect(form.getByLabel('Aylık (TRY)')).toBeVisible();
  await expect(form.getByLabel('Yıllık (EUR)')).toBeVisible();
});

test('reception has no add-on marketplace page', async ({ page }) => {
  await loginAs(page, LOGINS.reception);
  await page.goto('/ayarlar/uygulamalar');
  await expect(page.getByText('Bu sayfayı görüntüleme yetkiniz yok')).toBeVisible();
});

test('the owner sees the cards with the billing-currency price and starts a free trial', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/ayarlar/uygulamalar');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Uygulama pazarı', exact: true })).toBeVisible();
  await expect(main.getByText('Faturalama para birimi: TRY', { exact: true })).toBeVisible();
  const card = main.getByTestId('add-on-gamification-plus');
  await expect(card.getByText(/149,00/)).toBeVisible();
  await card.getByRole('button', { name: 'Ücretsiz dene', exact: true }).click();
  await expect(card.getByText('Deneme', { exact: true })).toBeVisible();
  await expect(card.getByText(/Denemenin bitmesine \d+ gün kaldı/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'İptal et', exact: true })).toBeVisible();
});
