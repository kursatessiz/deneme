import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';
import { uniqueSuffix } from './support/ids';

/**
 * G2a segment builder and campaign editor (docs/KAMPANYA_VE_AKISLAR.md):
 * the owner builds a rule set with a live preview count, saves it, then
 * prepares a campaign draft for the seeded "Aktif üyeler" segment and
 * deletes both again, so the spec can run any number of times.
 */

test('the owner builds a segment with a live preview, saves and archives it', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.locator('nav').getByText('Segmentler', { exact: true }).click();
  await page.waitForURL('**/segmentler');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Segmentler', exact: true })).toBeVisible();

  await main.getByRole('link', { name: 'Yeni segment' }).click();
  await page.waitForURL('**/segmentler/yeni');
  const name = `E2E segment ${uniqueSuffix()}`;
  await main.getByLabel('Segment adı').fill(name);

  // The default rule (lifecycle stage is "Aktif") already previews a count.
  const preview = main.getByTestId('segment-preview');
  await expect(preview.getByText(/kişi bu kurallara uyuyor/)).toBeVisible();

  // Add a second condition and switch it to "has a usable package: yes".
  await main.getByRole('button', { name: 'Koşul ekle' }).click();
  const conditions = main.getByTestId('segment-condition');
  await expect(conditions).toHaveCount(2);
  await conditions.nth(1).getByLabel('Alan').selectOption('package.hasActive');
  await expect(conditions.nth(1).getByLabel('İşlem')).toHaveValue('is_true');
  await expect(preview.getByText(/kişi bu kurallara uyuyor/)).toBeVisible();

  await main.getByRole('button', { name: 'Kaydet' }).click();
  await page.waitForURL(/\/segmentler\/[0-9a-f-]{36}$/);
  await expect(main.getByRole('heading', { name })).toBeVisible();

  await main.getByRole('button', { name: 'Arşivle' }).click();
  await page.waitForURL('**/segmentler');
  await expect(main.getByRole('link', { name })).toHaveCount(0);
});

test('the owner prepares a campaign draft for a segment and deletes it', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.locator('nav').getByText('Kampanyalar', { exact: true }).click();
  await page.waitForURL('**/kampanyalar');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Kampanyalar', exact: true })).toBeVisible();
  // The seeded draft is listed.
  await expect(main.getByRole('link', { name: 'Sonbahar dönemi duyurusu' })).toBeVisible();

  await main.getByRole('link', { name: 'Yeni kampanya' }).click();
  await page.waitForURL('**/kampanyalar/yeni');
  const name = `E2E kampanya ${uniqueSuffix()}`;
  await main.getByLabel('Kampanya adı').fill(name);
  await main.getByLabel('Segment', { exact: true }).selectOption({ label: 'Aktif üyeler' });
  await expect(main.getByText(/Segmentte şu an \d+ kişi var/)).toBeVisible();
  await main.getByLabel('Kanal').selectOption('SMS');
  await main.getByLabel('Mesaj şablonu').selectOption('WIN_BACK');
  await expect(main.getByText(/izin, abonelikten çıkma, sessiz saat ve sıklık sınırı/)).toBeVisible();

  await main.getByRole('button', { name: 'Taslağı kaydet' }).click();
  await page.waitForURL(/\/kampanyalar\/[0-9a-f-]{36}$/);
  await expect(main.getByRole('heading', { name })).toBeVisible();
  await expect(main.getByText('Taslak', { exact: true })).toBeVisible();

  await main.getByRole('button', { name: 'Sil' }).click();
  await page.waitForURL('**/kampanyalar');
  await expect(main.getByRole('link', { name })).toHaveCount(0);
});

test('a trainer cannot open segments or campaigns', async ({ page }) => {
  await loginAs(page, LOGINS.trainer);
  await expect(page.locator('nav').getByText('Segmentler', { exact: true })).toHaveCount(0);
  await page.goto('/kampanyalar');
  await expect(page.getByText('Bu sayfayı görüntüleme yetkiniz yok')).toBeVisible();
});
