import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

test.describe('Permission-driven navigation', () => {
  test('owner sees the full navigation', async ({ page }) => {
    await loginAs(page, LOGINS.owner);
    const nav = page.locator('nav');
    for (const label of [
      'Genel Bakış',
      'Takvim',
      'Yoklama',
      'Üyeler',
      'Paket Tanımları',
      'Eğitmenler',
      'Finans',
      'Hakediş',
      'Raporlar',
      'Adaylar',
      'Riskli Üyeler',
      'Ayarlar',
    ]) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('trainer sees a reduced navigation and hits the 403 view on restricted pages', async ({ page }) => {
    await loginAs(page, LOGINS.trainer);
    const nav = page.locator('nav');

    // The trainer's default role template has no finance/roles/reports/leads permissions.
    await expect(nav.getByText('Finans', { exact: true })).toHaveCount(0);
    await expect(nav.getByText('Ayarlar', { exact: true })).toHaveCount(0);
    await expect(nav.getByText('Raporlar', { exact: true })).toHaveCount(0);
    await expect(nav.getByText('Adaylar', { exact: true })).toHaveCount(0);

    // It does have schedule.view, members.view and attendance.manage.
    await expect(nav.getByText('Takvim', { exact: true })).toBeVisible();
    await expect(nav.getByText('Üyeler', { exact: true })).toBeVisible();
    await expect(nav.getByText('Yoklama', { exact: true })).toBeVisible();

    await page.goto('/ayarlar/roller');
    await expect(page.getByText('Bu sayfayı görüntüleme yetkiniz yok')).toBeVisible();

    await page.goto('/finans');
    await expect(page.getByText('Bu sayfayı görüntüleme yetkiniz yok')).toBeVisible();
  });
});
