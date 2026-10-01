import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './support/login';
import { uniqueSuffix } from './support/ids';

/**
 * Field-based block forms of the page engine editor (docs/SAYFA_MOTORU.md "Editörler"): the super admin creates
 * a page, adds a hero block and fills it through labelled inputs (no raw JSON), sees the schema's validation
 * message inline, saves, checks the collapsed JSON view mirrors the form, publishes and finds the text on the
 * public page. The page is unpublished again at the end.
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

test('super admin builds a hero block through the form and publishes it', async ({ page }) => {
  const suffix = uniqueSuffix();
  const slug = `e2e-form-${suffix}`;
  const heading = `Form ile başlık ${suffix}`;

  await loginAsSuperAdmin(page);
  await page.goto('/admin/web-sitesi');
  const main = page.getByRole('main');

  // A new custom page.
  await main.getByLabel('Yeni sayfa etiketi').fill(`E2E form ${suffix}`);
  await main.getByLabel('Sayfa türü').selectOption('CUSTOM');
  await main.getByRole('button', { name: 'Sayfa oluştur' }).click();

  // Add a hero block: the form shows labelled inputs, not a JSON textarea.
  await main.getByLabel('Blok ekle...').selectOption('hero');
  const block = main.locator('div.ui-panel').filter({ has: page.locator('span.ui-mono', { hasText: /^hero$/ }) });
  await expect(block.getByLabel('Başlık', { exact: true })).toBeVisible();
  await expect(block.getByLabel('Alt başlık')).toBeVisible();
  await expect(block.getByLabel('Birincil buton bağlantısı')).toBeVisible();

  await block.getByLabel('Başlık', { exact: true }).fill(heading);
  await block.getByLabel('Alt başlık').fill('Alt başlık metni');
  await block.getByLabel('Birincil buton metni').fill('Hemen başla');

  // The schema's link rule shows inline, in Turkish, and blocks the save.
  await block.getByLabel('Birincil buton bağlantısı').fill('javascript:alert(1)');
  await expect(block.getByText(/Geçersiz bağlantı/)).toBeVisible();
  await main.getByRole('button', { name: 'Blokları kaydet' }).click();
  await expect(main.getByText('1 blokta düzeltilmesi gereken alanlar var')).toBeVisible();

  await block.getByLabel('Birincil buton bağlantısı').fill('#iletisim');
  await expect(block.getByText(/Geçersiz bağlantı/)).toBeHidden();
  await main.getByRole('button', { name: 'Blokları kaydet' }).click();
  await expect(main.getByText('Bloklar kaydedildi')).toBeVisible();

  // The collapsed JSON view mirrors the form.
  await block.getByText('Gelişmiş (JSON)').click();
  const json = block.getByRole('textbox', { name: 'Gelişmiş (JSON)' });
  await expect(json).toHaveValue(new RegExp(heading));
  await expect(json).toHaveValue(/"primaryCtaHref": "#iletisim"/);

  // The Turkish slug; the editor reloads the page afterwards and the saved block comes back into the form.
  await main.getByLabel('Yol (slug)').fill(slug);
  await main.getByRole('button', { name: 'tr için kaydet' }).click();
  await expect(main.getByLabel('Yol (slug)')).toHaveValue(slug);
  const reloaded = main.locator('div.ui-panel').filter({ has: page.locator('span.ui-mono', { hasText: /^hero$/ }) });
  await expect(reloaded.getByLabel('Başlık', { exact: true })).toHaveValue(heading);

  // Publish; the text of the form is on the public page.
  await main.getByRole('button', { name: 'Yayınla', exact: true }).click();
  await expect(main.getByRole('button', { name: 'Yayından kaldır' })).toBeVisible();
  await page.goto(`/tr/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);

  // Leave the page unpublished.
  await page.goto('/admin/web-sitesi');
  await page.getByRole('main').getByRole('button', { name: new RegExp(`E2E form ${suffix}`) }).click();
  await page.getByRole('main').getByRole('button', { name: 'Yayından kaldır' }).click();
  await expect(page.getByRole('main').getByRole('button', { name: 'Yayınla', exact: true })).toBeVisible();
});

test('a FAQ block takes repeatable items with per-item validation', async ({ page }) => {
  const suffix = uniqueSuffix();
  await loginAsSuperAdmin(page);
  await page.goto('/admin/web-sitesi');
  const main = page.getByRole('main');

  await main.getByLabel('Yeni sayfa etiketi').fill(`E2E sss ${suffix}`);
  await main.getByLabel('Sayfa türü').selectOption('CUSTOM');
  await main.getByRole('button', { name: 'Sayfa oluştur' }).click();

  await main.getByLabel('Blok ekle...').selectOption('faq');
  const block = main.locator('div.ui-panel').filter({ has: page.locator('span.ui-mono', { hasText: /^faq$/ }) });
  await block.getByRole('button', { name: 'Öğe ekle' }).click();
  await block.getByLabel('Soru').fill('Ders iptal edilebilir mi?');
  await block.getByLabel('Cevap').fill('Evet, 24 saat öncesine kadar.');
  await block.getByRole('button', { name: 'Öğe ekle' }).click();
  await expect(block.getByLabel('Soru')).toHaveCount(2);
  await block.getByRole('button', { name: 'Kaldır' }).last().click();
  await expect(block.getByLabel('Soru')).toHaveCount(1);
  await main.getByRole('button', { name: 'Blokları kaydet' }).click();
  await expect(main.getByText('Bloklar kaydedildi')).toBeVisible();
});
