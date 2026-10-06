import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

/**
 * G5d-1 conversion funnels: the "Huniler" tab on /raporlar. The seed may or
 * may not contain conversion events in the default range, so a funnel
 * renders either its step list or the empty state; both mean it loaded.
 */
test('owner opens the funnels tab, switches funnel, breakdown and compare', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/raporlar');
  const main = page.getByRole('main');

  await main.getByRole('button', { name: 'Huniler' }).click();

  const funnelSelect = main.getByRole('combobox', { name: 'Huni' });
  await expect(funnelSelect).toBeVisible();
  // The three ready-made funnels are always offered.
  await expect(funnelSelect.getByRole('option', { name: 'Adaydan üyeye' })).toHaveCount(1);
  await expect(funnelSelect.getByRole('option', { name: 'Deneme randevusundan üyeye' })).toHaveCount(1);
  await expect(funnelSelect.getByRole('option', { name: 'Ziyaretçiden üyeye' })).toHaveCount(1);

  const rendered = () => main.getByRole('list', { name: 'Dönüşüm hunileri' }).or(main.getByText('Bu aralıkta veri yok'));
  await expect(rendered()).toBeVisible();

  await funnelSelect.selectOption({ label: 'Deneme randevusundan üyeye' });
  await expect(rendered()).toBeVisible();

  await main.getByRole('combobox', { name: 'Kırılım' }).selectOption('source');
  await expect(rendered()).toBeVisible();

  await main.getByLabel('Önceki dönemle karşılaştır').check();
  await expect(rendered()).toBeVisible();
});

test('owner creates, edits and deletes a tenant funnel', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/raporlar');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Huniler' }).click();

  const name = `Playwright hunisi ${Date.now()}`;
  await main.getByRole('button', { name: 'Yeni huni' }).click();
  const form = main.locator('form');
  await form.getByLabel('Huni adı').fill(name);
  // Two default steps (lead, purchase); add a third and cap the step time at 14 days.
  await form.getByRole('button', { name: 'Adım ekle' }).click();
  await expect(form.getByRole('combobox')).toHaveCount(3);
  await form.getByLabel('Adımlar arası en fazla süre (gün)').fill('14');
  await form.getByRole('button', { name: 'Kaydet' }).click();

  // The new funnel is selected and offered under "Kendi hunilerim".
  const funnelSelect = main.getByRole('combobox', { name: 'Huni' });
  await expect(funnelSelect.getByRole('option', { name })).toHaveCount(1);
  await expect(main.getByText('Adımlar arası en fazla 14 gün')).toBeVisible();

  // Edit: drop the window.
  await main.getByRole('button', { name: 'Düzenle' }).click();
  await main.locator('form').getByLabel('Adımlar arası en fazla süre (gün)').fill('');
  await main.locator('form').getByRole('button', { name: 'Kaydet' }).click();
  await expect(main.getByText('Adımlar arası süre sınırı yok')).toBeVisible();

  // Delete.
  await main.getByRole('button', { name: 'Sil' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Onayla', exact: true }).click();
  await expect(funnelSelect.getByRole('option', { name })).toHaveCount(0);
});

test('reception without reports.view cannot open the reports page', async ({ page }) => {
  await loginAs(page, LOGINS.reception);
  await page.goto('/raporlar');
  await expect(page.getByText(/yetki|izin/i)).toBeVisible();
});
