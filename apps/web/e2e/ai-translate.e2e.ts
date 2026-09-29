import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './support/login';

/**
 * G3b "Translate with AI" (docs/YAPAY_ZEKA.md), driven by the super admin:
 * paste a provider key, test the connection, add a language, translate one
 * section in the background, watch it finish, filter the unreviewed AI
 * values and approve them. The API runs with AI_FAKE_PROVIDER=1 (see
 * playwright.config.ts), so no real provider is called. Without Redis the
 * job advances on the scheduler heartbeat, which the spec triggers through
 * the BFF like the super admin's "run now" call. Everything it creates is
 * removed at the end.
 */

const SUPER_ADMIN_PHONE = '+905321000001';
const FAKE_KEY = 'sk-ant-api03-playwright-fake-key-0000PWKY';
const CSRF = { 'x-requested-with': 'platform-web' };

/** ISO 639 reserves qaa-qtz for local use; a random one keeps parallel or repeated runs apart. */
function localCode(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const pick = () => letters[Math.floor(Math.random() * letters.length)];
  return `q${'abcdefghijklmnopqrst'[Math.floor(Math.random() * 20)]}${pick()}`;
}

async function loginAsSuperAdmin(page: Page): Promise<void> {
  await page.goto('/giris');
  const form = page.locator('form').first();
  await form.locator('input:not([type="password"])').first().fill(SUPER_ADMIN_PHONE);
  await form.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/giris'));
}

test('the super admin sets the AI key and translates a language section with AI', async ({ page }) => {
  test.setTimeout(120_000);
  const code = localCode();
  await loginAsSuperAdmin(page);

  try {
    // 1. Key: saved encrypted, only the last four characters come back.
    await page.goto('/admin/ai');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Yapay zeka', exact: true })).toBeVisible();
    await main.getByRole('textbox', { name: 'API anahtarı', exact: true }).fill(FAKE_KEY);
    await main.getByRole('button', { name: /Anahtarı (kaydet|değiştir)/ }).click();
    await expect(main.getByTestId('ai-key-status')).toHaveText('Tanımlı anahtar: ****PWKY');
    await expect(main.getByText('Anahtar şifrelenerek kaydedildi.')).toBeVisible();
    await expect(main.getByRole('textbox', { name: 'API anahtarı', exact: true })).toHaveValue('');
    await expect(main.getByText(FAKE_KEY)).toHaveCount(0);

    await main.getByRole('button', { name: 'Bağlantıyı test et' }).click();
    await expect(main.getByText(/Bağlantı çalışıyor/)).toBeVisible();

    // 2. A new language, created in the CMS.
    await page.goto('/admin/i18n');
    await main.getByPlaceholder('Kod').fill(code);
    await main.getByPlaceholder('Ad', { exact: true }).fill(`E2E ${code}`);
    await main.getByPlaceholder('Yerel ad').fill(`E2E ${code}`);
    await main.getByRole('button', { name: 'Dil ekle' }).click();
    const row = main.getByRole('row').filter({ hasText: code });
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: 'Çevirileri düzenle' }).click();
    await page.waitForURL(`**/admin/i18n/${code}`);

    // 3. Translate the "common" section in the background.
    const panel = main.getByRole('region', { name: 'Yapay zeka ile çevir' });
    await expect(panel).toBeVisible();
    await panel.getByRole('checkbox', { name: 'common', exact: true }).check();
    await panel.getByRole('button', { name: 'Çeviriyi başlat' }).click();
    const job = panel.getByTestId('ai-translate-job');
    await expect(job.getByText('Sırada', { exact: true })).toBeVisible();

    // No Redis in this stack: one heartbeat runs the queued job.
    const beat = await page.request.post('/api/bff/admin/scheduler/run', { headers: CSRF, data: {} });
    expect(beat.ok()).toBeTruthy();
    await expect(job.getByText('Tamamlandı', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(job.getByText(/^(\d+) \/ \1 tamamlandı/)).toBeVisible();

    // 4. Review: filter the unreviewed AI values, check placeholders, approve.
    await main.getByLabel('Kaynak', { exact: true }).selectOption('AI_UNREVIEWED');
    const pluralRow = main.getByRole('row').filter({ hasText: 'common.itemCount.other' });
    await expect(pluralRow.getByRole('textbox')).toHaveValue(/\{count\}/);
    await expect(pluralRow.getByText('Yapay zeka, onay bekliyor')).toBeVisible();
    await main.getByRole('button', { name: 'Görünen yapay zeka çevirilerini onayla' }).click();
    await expect(main.getByText('Yapay zeka, onay bekliyor')).toHaveCount(0);

    await main.getByLabel('Kaynak', { exact: true }).selectOption('AI');
    await expect(main.getByRole('row').filter({ hasText: 'common.itemCount.other' }).getByText('Yapay zeka', { exact: true })).toBeVisible();
  } finally {
    await page.request.delete(`/api/bff/admin/i18n/languages/${code}`, { headers: CSRF });
    await page.request.delete('/api/bff/admin/ai/settings/key', { headers: CSRF });
  }
});

test('the AI settings page is not reachable for a studio owner', async ({ page }) => {
  await page.goto('/giris');
  const form = page.locator('form').first();
  await form.locator('input:not([type="password"])').first().fill('+905321000002');
  await form.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL('**/dashboard');
  await page.goto('/admin/ai');
  await page.waitForURL(/\/giris/);
});
