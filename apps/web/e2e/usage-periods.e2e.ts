import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

// Seeded session package of the Zen Reformer demo studio (packages/database/prisma/seed.ts).
const SESSION_PACKAGE = '10 Seans Birebir Reformer';

test('owner enables usage periods, sets a rule on a package and sees the summary', async ({ page }) => {
  await loginAs(page, LOGINS.owner);

  await page.goto('/ayarlar/isletme');
  const toggle = page.getByRole('switch', { name: 'Kullanım dönemlerini etkinleştir' });
  await expect(toggle).toBeEnabled();
  // A previous run may have left the switch on; turn it off first so the save below always happens.
  if (await toggle.isChecked()) {
    await toggle.uncheck();
    await expect(page.getByText('Kullanım dönemleri ayarı kaydedildi')).toBeVisible();
    await expect(toggle).toBeEnabled();
  }
  await toggle.check();
  await expect(page.getByText('Kullanım dönemleri ayarı kaydedildi')).toBeVisible();
  await expect(toggle).toBeChecked();

  await page.goto('/packages');
  const cell = page.getByRole('heading', { name: SESSION_PACKAGE }).locator('xpath=ancestor::div[contains(@class,"content-start")]');
  const editor = cell.getByRole('region', { name: 'Kullanım dönemi kuralı' });
  // A previous run may have left a rule behind; start from none.
  const remove = editor.getByRole('button', { name: 'Kuralı kaldır' });
  if (await remove.isVisible()) {
    await remove.click();
    await expect(editor.getByText('Bu pakette dönem kuralı yok.')).toBeVisible();
  }
  await expect(editor.getByText('Kullanım dönemleri işletme ayarlarında kapalı')).toHaveCount(0);

  await editor.getByRole('button', { name: 'Kural ekle' }).click();
  await editor.getByLabel('Dönem başına seans hakkı').fill('8');
  await editor.getByRole('checkbox', { name: 'Kullanılmayan haklar dönem sonunda yansın' }).check();
  await expect(editor.getByTestId('usage-rule-preview')).toContainText('Ayda 8 seans; kullanılmayan haklar dönem sonunda yanar.');

  await editor.getByRole('button', { name: 'İkinci katman ekle' }).click();
  await editor.getByLabel('Dönem başına seans hakkı').nth(1).fill('2');
  await expect(editor.getByTestId('usage-rule-preview')).toContainText('Ayda 8 seans; kullanılmayan haklar dönem sonunda yanar. Haftada en fazla 2 seans.');

  // The shared schema rejects a weekly quota above the monthly one before anything is sent.
  await editor.getByLabel('Dönem başına seans hakkı').nth(1).fill('9');
  await editor.getByRole('button', { name: 'Kaydet' }).click();
  await expect(editor.getByText('Kısa dönemin hakkı uzun dönemin hakkından fazla olamaz')).toBeVisible();

  await editor.getByLabel('Dönem başına seans hakkı').nth(1).fill('2');
  await editor.getByRole('button', { name: 'Kaydet' }).click();
  await expect(editor.getByText('Kural kaydedildi')).toBeVisible();
  await expect(editor.getByTestId('usage-rule-summary')).toContainText('Ayda 8 seans; kullanılmayan haklar dönem sonunda yanar. Haftada en fazla 2 seans.');
  await expect(editor.getByText('Kural yalnızca yeni satışlara ve yenilemelere uygulanır')).toBeVisible();

  // Clean up so the demo data and the other specs are unaffected.
  await editor.getByRole('button', { name: 'Kuralı kaldır' }).click();
  await expect(editor.getByText('Bu pakette dönem kuralı yok.')).toBeVisible();
  await page.goto('/ayarlar/isletme');
  await page.getByRole('switch', { name: 'Kullanım dönemlerini etkinleştir' }).uncheck();
  await expect(page.getByText('Kullanım dönemleri ayarı kaydedildi')).toBeVisible();
});

test('staff who is not the owner sees the usage periods switch disabled with an explanation', async ({ page }) => {
  await loginAs(page, LOGINS.reception);
  await page.goto('/ayarlar/isletme');
  await expect(page.getByRole('heading', { name: 'Kullanım dönemleri' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Kullanım dönemlerini etkinleştir' })).toBeDisabled();
  await expect(page.getByText('Bu ayarı yalnızca işletme sahibi değiştirebilir.')).toBeVisible();
});
