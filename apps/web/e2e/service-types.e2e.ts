import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';
import { uniqueSuffix } from './support/ids';

const HELPER =
  'Üye aynı hizmetten iki seans arasında en az bu kadar gün bırakmalıdır. Gelinmeyen (no-show) seanslar bu kurala sayılmaz; personel rezervasyon sırasında kuralı onayla aşabilir.';

test('owner creates a service type, edits the repeat interval and deactivates it', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/ayarlar');
  await page.getByRole('link', { name: /Hizmet türleri/ }).click();
  await page.waitForURL('**/ayarlar/hizmet-turleri');

  const name = `E2E Hizmet ${uniqueSuffix()}`;
  await page.getByRole('button', { name: 'Yeni hizmet türü' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Ad', { exact: true }).fill(name);
  await dialog.getByLabel('Süre (dakika)').fill('45');
  await dialog.getByLabel('Kapasite', { exact: true }).fill('6');
  await dialog.getByRole('button', { name: 'Kaydet' }).click();

  const row = page.getByTestId('service-type-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText('45 dk');
  await expect(row).toContainText('Aktif');

  await row.getByRole('button', { name: 'Düzenle' }).click();
  const edit = page.getByRole('dialog');
  await expect(edit.getByText(HELPER)).toBeVisible();
  await edit.getByRole('spinbutton', { name: /En az tekrar aralığı/ }).fill('7');
  await edit.getByRole('button', { name: 'Kaydet' }).click();
  await expect(edit).toBeHidden();

  await row.getByRole('button', { name: 'Düzenle' }).click();
  await expect(page.getByRole('dialog').getByRole('spinbutton', { name: /En az tekrar aralığı/ })).toHaveValue('7');
  await page.getByRole('dialog').getByRole('button', { name: 'Vazgeç' }).click();

  await row.getByRole('button', { name: 'Pasifleştir' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Pasifleştir' }).click();
  await expect(row).toContainText('Pasif');
  await expect(row.getByRole('button', { name: 'Pasifleştir' })).toHaveCount(0);
});

test('shows validation errors in Turkish for an invalid form', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/ayarlar/hizmet-turleri');
  await page.getByRole('button', { name: 'Yeni hizmet türü' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Ad', { exact: true }).fill('a');
  await dialog.getByRole('button', { name: 'Kaydet' }).click();
  await expect(dialog.getByText('Hizmet adı en az 2 karakter olmalıdır')).toBeVisible();
});

test('a role without catalog.manage sees the list read-only', async ({ page }) => {
  await loginAs(page, LOGINS.reception);
  await page.goto('/ayarlar/hizmet-turleri');
  await expect(page.getByText('Hizmet türlerini yalnızca görüntüleyebilirsiniz')).toBeVisible();
  await expect(page.getByTestId('service-type-row').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yeni hizmet türü' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Düzenle' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pasifleştir' })).toHaveCount(0);
});

test('a role without catalog.view cannot open the page', async ({ page }) => {
  await loginAs(page, LOGINS.trainer);
  await page.goto('/ayarlar/hizmet-turleri');
  await expect(page.getByText('Bu sayfayı görüntüleme yetkiniz yok')).toBeVisible();
});
