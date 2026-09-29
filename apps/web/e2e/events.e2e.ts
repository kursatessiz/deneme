import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';
import { uniqueSuffix } from './support/ids';

/**
 * G3c-1 events (docs/ETKINLIKLER.md): the owner creates an event with its
 * first session, adds a free ticket, publishes it, sees the empty
 * registrations tab and cancels it again, so the spec can run any number
 * of times (cancelled events stay in the list under a unique title).
 * Reception sees the seeded workshop and its registrations but cannot
 * create events; a trainer cannot open the page.
 */

test.use({ actionTimeout: 15_000 });

/** `datetime-local` value N days from now at the given hour. */
function localInput(daysAhead: number, hour: number): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
}

test('the owner creates, publishes and cancels an event', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.locator('nav').getByText('Etkinlikler', { exact: true }).click();
  await page.waitForURL('**/etkinlikler');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Etkinlikler', exact: true })).toBeVisible();

  await main.getByRole('link', { name: 'Yeni etkinlik', exact: true }).first().click();
  await page.waitForURL('**/etkinlikler/yeni');
  const title = `E2E atölye ${uniqueSuffix()}`;
  await main.getByLabel('Başlık', { exact: true }).fill(title);
  await main.getByLabel('Kontenjan', { exact: true }).fill('6');
  await main.getByLabel('İlk oturum başlangıcı', { exact: true }).fill(localInput(20, 10));
  await main.getByLabel('İlk oturum bitişi', { exact: true }).fill(localInput(20, 12));
  await main.getByRole('button', { name: 'Etkinliği oluştur', exact: true }).click();
  await page.waitForURL(/\/etkinlikler\/[0-9a-f-]{36}$/);
  await expect(main.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(main.getByText('Taslak', { exact: true })).toBeVisible();

  // Ticket: a free one, so publishing is possible.
  await main.getByRole('button', { name: 'Biletler', exact: true }).click();
  await main.getByLabel('Bilet adı', { exact: true }).fill('Genel giriş');
  await main.getByRole('button', { name: 'Bileti ekle', exact: true }).click();
  const ticket = main.getByTestId('event-tickets').getByRole('listitem').filter({ hasText: 'Genel giriş' });
  await expect(ticket).toBeVisible();
  await expect(ticket.getByText('Ücretsiz - 0 satıldı', { exact: true })).toBeVisible();

  // Publish from the details tab.
  await main.getByRole('button', { name: 'Genel', exact: true }).click();
  await main.getByRole('button', { name: 'Yayınla', exact: true }).click();
  await expect(main.getByText('Etkinlik yayınlandı.', { exact: true })).toBeVisible();
  await expect(main.getByText('Yayında', { exact: true })).toBeVisible();

  await main.getByRole('button', { name: 'Kayıtlar', exact: true }).click();
  await expect(main.getByText('Henüz kayıt yok.', { exact: true })).toBeVisible();
  await expect(main.getByRole('link', { name: 'CSV indir', exact: true })).toBeVisible();

  // Cancel it again.
  await main.getByRole('button', { name: 'Genel', exact: true }).click();
  await main.getByRole('button', { name: 'Etkinliği iptal et', exact: true }).click();
  await main.getByRole('button', { name: 'İptali onayla', exact: true }).click();
  await expect(main.getByText('İptal edildi', { exact: true })).toBeVisible();
  await expect(main.getByText('İptal edilmiş veya tamamlanmış etkinlik değiştirilemez.', { exact: true })).toBeVisible();
});

test('reception sees the seeded workshop and its registrations but cannot create events', async ({ page }) => {
  await loginAs(page, LOGINS.reception);
  await page.goto('/etkinlikler');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Etkinlikler', exact: true })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Yeni etkinlik', exact: true })).toHaveCount(0);
  await main.getByRole('link', { name: 'Hafta sonu atölyesi', exact: true }).click();
  await page.waitForURL(/\/etkinlikler\/[0-9a-f-]{36}$/);
  await main.getByRole('button', { name: 'Kayıtlar', exact: true }).click();
  await expect(main.getByRole('table', { name: 'Kayıtlar' }).getByRole('row')).toHaveCount(3);
  await expect(main.getByRole('button', { name: 'Kaydı iptal et', exact: true })).toHaveCount(0);
});

test('a trainer cannot open the events page', async ({ page }) => {
  await loginAs(page, LOGINS.trainer);
  await page.goto('/etkinlikler');
  await expect(page.getByRole('main').getByText('Bu sayfayı görüntüleme yetkiniz yok')).toBeVisible();
});
