import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './support/login';

/**
 * M2 marketing studio (docs/PAZARLAMA_MODULU.md 3.4, 4), driven by the super
 * admin in the marketing panel: the brand kit with a banned phrase and a
 * product fact, AI drafts from a brief (the API runs with AI_FAKE_PROVIDER=1,
 * see playwright.config.ts), the brand check on an edited variant, and the
 * content calendar with a moved item. Nothing is sent from any of these
 * screens. The product fact it adds is removed at the end.
 */

test.use({ actionTimeout: 15_000 });

const SUPER_ADMIN_PHONE = '+905321000001';
const FAKE_KEY = 'sk-ant-api03-playwright-fake-key-0000PWKY';
const CSRF = { 'x-requested-with': 'platform-web' };

async function bff(page: Page, method: 'PUT' | 'DELETE', path: string, data?: unknown): Promise<number> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.fetch(`/api/bff/${path}`, {
    method,
    headers: { ...CSRF, origin, 'content-type': 'application/json' },
    data,
    timeout: 30_000,
  });
  return res.status();
}

async function loginAsSuperAdmin(page: Page): Promise<void> {
  await page.goto('/giris');
  const form = page.locator('form').first();
  await form.locator('input:not([type="password"])').first().fill(SUPER_ADMIN_PHONE);
  await form.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/giris'));
}

/** "Çarşamba 21 Ekim" as the calendar prints it in Turkish. */
function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('tr', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00.000Z`));
}

test('brand kit, AI drafts with a brand check, and the content calendar', async ({ page }) => {
  test.setTimeout(150_000);
  const factKey = `e2e.${Date.now().toString(36)}`;
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const day10 = `${month}-10`;
  const day11 = `${month}-11`;
  const itemTitle = `Lansman e-postası ${factKey}`;

  await loginAsSuperAdmin(page);
  // The AI provider key for the fake provider (super admin only).
  expect(await bff(page, 'PUT', 'admin/ai/settings/key', { apiKey: FAKE_KEY })).toBe(200);

  // 1. Brand kit: name, positioning, a banned phrase and a product fact.
  await page.goto('/pazarlama/marka');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Marka kiti', exact: true })).toBeVisible();
  await main.getByLabel('Marka adı', { exact: true }).fill('Acme Platform');
  await main.getByLabel('Konumlandırma cümlesi', { exact: true }).fill('Randevu işletmeleri için tek panel');
  await main.getByLabel('Yasaklı ifadeler', { exact: true }).fill('garanti\nen iyi');
  await main.getByRole('button', { name: 'Marka kitini kaydet' }).click();
  await expect(main.getByText('Marka kiti kaydedildi.')).toBeVisible();

  await main.getByRole('button', { name: 'Ürün gerçeği ekle' }).click();
  await main.getByLabel('Anahtar', { exact: true }).fill(factKey);
  await main.getByLabel('İfade (tr)', { exact: true }).fill('Çok kiracılı yapı');
  await main.getByRole('button', { name: 'Gerçeği kaydet' }).click();
  await expect(main.getByRole('cell', { name: factKey, exact: true })).toBeVisible();

  // 2. AI studio: a brief becomes drafts; every output is a draft.
  await page.goto('/pazarlama/yapay-zeka');
  await expect(main.getByRole('heading', { name: 'Yapay zeka stüdyosu', exact: true })).toBeVisible();
  await main.getByLabel('Amaç', { exact: true }).fill('Yeni stüdyoları platforma davet et');
  await main.getByRole('button', { name: 'Taslakları üret' }).click();
  await expect(main.getByText('2 taslak oluşturuldu.')).toBeVisible();
  const smsDraft = main.getByRole('article').filter({ hasText: 'Mesaj metni' }).first();
  await expect(smsDraft.getByText('Taslak', { exact: true }).first()).toBeVisible();
  await expect(smsDraft.getByText('Varyant A', { exact: true }).first()).toBeVisible();

  // 3. Editing a variant re-runs the deterministic brand check and shows the banned phrase.
  await smsDraft.getByLabel('Mesaj metni').first().fill('Garanti sonuç, hemen deneyin.');
  await smsDraft.getByRole('button', { name: 'Varyant A kaydet' }).click();
  await expect(smsDraft.getByText('Yasaklı ifade kullanılmış: "garanti" (text).')).toBeVisible();
  // A blocking issue keeps the export button off.
  await expect(smsDraft.getByRole('button', { name: 'Kampanya taslağı oluştur' })).toBeDisabled();

  // 4. Content calendar: create an item, move it to the next day by drag and drop, delete it.
  await page.goto('/pazarlama/takvim');
  await expect(main.getByRole('heading', { name: 'İçerik takvimi', exact: true })).toBeVisible();
  await main.getByRole('button', { name: `${dayLabel(day10)} gününe öğe ekle` }).click();
  await main.getByLabel('Başlık', { exact: true }).fill(itemTitle);
  await main.getByRole('button', { name: 'Kaydet', exact: true }).click();
  const cell10 = main.getByRole('gridcell', { name: dayLabel(day10), exact: true });
  const cell11 = main.getByRole('gridcell', { name: dayLabel(day11), exact: true });
  const chip = cell10.getByRole('button', { name: new RegExp(itemTitle) });
  await expect(chip).toBeVisible();
  await chip.dragTo(cell11);
  await expect(cell11.getByRole('button', { name: new RegExp(itemTitle) })).toBeVisible();

  await cell11.getByRole('button', { name: new RegExp(itemTitle) }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await main.getByRole('button', { name: 'Öğeyi sil' }).click();
  await expect(main.getByRole('button', { name: new RegExp(itemTitle) })).toHaveCount(0);

  // Cleanup: the product fact of this run.
  await page.goto('/pazarlama/marka');
  page.once('dialog', (dialog) => void dialog.accept());
  await main.getByRole('row', { name: new RegExp(factKey) }).getByRole('button', { name: 'Kaldır' }).click();
  await expect(main.getByRole('cell', { name: factKey, exact: true })).toHaveCount(0);
  await bff(page, 'DELETE', 'admin/ai/settings/key');
});
