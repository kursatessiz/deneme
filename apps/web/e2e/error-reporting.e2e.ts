import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD, LOGINS, loginAs } from './support/login';

/**
 * H1 error reporting (docs/HATA_RAPORLAMA.md): an uncaught error on a
 * public page is reported through the dedicated telemetry route under the
 * nonce CSP, the super admin finds and handles the group, the owner sees
 * the studio's error report page and reception is refused.
 */

const SUPER_ADMIN_PHONE = '+905321000001';

function letters(n: number): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < n; i++) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}

async function loginAsSuperAdmin(page: Page): Promise<void> {
  await page.goto('/giris');
  const form = page.locator('form').first();
  await form.locator('input:not([type="password"])').first().fill(SUPER_ADMIN_PHONE);
  await form.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/giris'));
}

test('an uncaught error is reported and handled by the super admin', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = `pw${letters(10)}`;

  // /giris runs under the strict nonce CSP; the reporter needs no inline script.
  const cspViolations: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) cspViolations.push(msg.text());
  });
  await page.goto('/giris');
  const reported = page.waitForResponse((res) => res.url().endsWith('/api/telemetry/errors') && res.request().method() === 'POST');
  await page.evaluate((t) => {
    setTimeout(() => {
      throw new Error(`Playwright failure ${t} for ada@example.com`);
    }, 0);
  }, tag);
  const response = await reported;
  expect(response.status()).toBe(202);
  const sent = response.request().postDataJSON() as { events: Array<{ message: string; route: string }> };
  expect(sent.events[0].message).toContain(tag);
  // Scrubbed in the browser already.
  expect(sent.events[0].message).not.toContain('ada@example.com');
  expect(sent.events[0].route).toBe('/giris');
  expect(cspViolations).toEqual([]);

  await page.context().clearCookies();
  await loginAsSuperAdmin(page);
  await page.goto('/admin/hatalar');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Hatalar' })).toBeVisible();

  const search = main.getByRole('search');
  await search.getByRole('textbox', { name: 'Hata kodu veya başlık' }).fill(tag);
  await search.getByRole('button', { name: 'Filtrele' }).click();
  const link = main.getByRole('link', { name: new RegExp(tag) });
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(/\/admin\/hatalar\/[0-9a-f-]{36}$/);

  await expect(main.getByText('Web paneli').first()).toBeVisible();
  await main.getByRole('button', { name: 'Yok say' }).click();
  await expect(main.getByRole('button', { name: 'Yeniden aç' })).toBeVisible();
  await main.getByRole('button', { name: 'Yeniden aç' }).click();
  await expect(main.getByRole('button', { name: 'Yok say' })).toBeVisible();

  await main.getByRole('textbox', { name: 'Not' }).fill('Playwright notu');
  await main.getByRole('button', { name: 'Notu kaydet' }).click();
  await expect(main.getByRole('status')).toHaveText('Not kaydedildi.');
});

test('the owner sees the error report page, reception does not', async ({ page }) => {
  await loginAs(page, LOGINS.owner);
  await page.goto('/ayarlar');
  const main = page.getByRole('main');
  await main.getByRole('link', { name: /Hata raporları/ }).click();
  await page.waitForURL('**/ayarlar/hatalar');
  await expect(main.getByRole('heading', { name: 'Hata raporları' })).toBeVisible();
  await expect(main.getByRole('table').or(main.getByText('Son 30 günde kayıtlı bir hata yok.'))).toBeVisible();

  await page.context().clearCookies();
  await loginAs(page, LOGINS.reception);
  await page.goto('/ayarlar/hatalar');
  await expect(page.getByRole('main').getByText('Bu sayfayı görüntüleme yetkiniz yok')).toBeVisible();
});
