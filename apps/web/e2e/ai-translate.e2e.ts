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

// Fail a stuck action with its own message instead of the whole-test timeout.
test.use({ actionTimeout: 15_000 });

const SUPER_ADMIN_PHONE = '+905321000001';
const FAKE_KEY = 'sk-ant-api03-playwright-fake-key-0000PWKY';
const CSRF = { 'x-requested-with': 'platform-web' };

/** ISO 639 reserves qaa-qtz for local use; a random one keeps parallel or repeated runs apart. */
function localCode(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const pick = () => letters[Math.floor(Math.random() * letters.length)];
  return `q${'abcdefghijklmnopqrst'[Math.floor(Math.random() * 20)]}${pick()}`;
}

/**
 * Calls the BFF with the browser context's cookies. APIRequestContext sends
 * no Origin header by itself, so it is set to the page's origin, which is
 * what the BFF's CSRF check expects from the web app.
 */
async function bff(page: Page, method: 'GET' | 'POST' | 'DELETE', path: string): Promise<{ status: number; body: unknown }> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.fetch(`/api/bff/${path}`, {
    method,
    headers: { ...CSRF, origin, 'content-type': 'application/json' },
    data: method === 'POST' ? {} : undefined,
    timeout: 30_000,
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status(), body };
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
    // The page shows a loading state until the whole language pack has
    // arrived, which takes longer than the default 5 s on a busy CI runner.
    const panel = main.getByRole('region', { name: 'Yapay zeka ile çevir' });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByRole('checkbox', { name: 'common', exact: true }).check();
    await panel.getByRole('button', { name: 'Çeviriyi başlat' }).click();
    const job = panel.getByTestId('ai-translate-job');
    await expect(job.getByText('Sırada', { exact: true })).toBeVisible();

    // No Redis in this stack: run the queued job now (the full scheduler
    // heartbeat would also do it, but runs every other periodic task too).
    const jobs = await bff(page, 'GET', `admin/i18n/languages/${code}/ai-translate/jobs`);
    expect(jobs.status).toBe(200);
    const list = (Array.isArray(jobs.body) ? jobs.body : (jobs.body as { items?: unknown[] }).items ?? []) as { id: string }[];
    expect(list.length).toBeGreaterThan(0);
    const run = await bff(page, 'POST', `admin/ai/translation-jobs/${list[0].id}/run`);
    expect(run.status).toBe(200);
    // The fake provider translates every key of the section; a loaded CI runner needs well over 30 seconds.
    await expect(job.getByText('Tamamlandı', { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(job.getByText(/^(\d+) \/ \1 tamamlandı/)).toBeVisible();

    // 4. Review: filter the unreviewed AI values, check placeholders, approve.
    await main.locator('#i18n-source-filter').selectOption('AI_UNREVIEWED');
    const pluralRow = main.getByRole('row').filter({ hasText: 'common.itemCount.other' });
    await expect(pluralRow.getByRole('textbox')).toHaveValue(/\{count\}/);
    await expect(pluralRow.getByText('Yapay zeka, onay bekliyor')).toBeVisible();
    await main.getByRole('button', { name: 'Görünen yapay zeka çevirilerini onayla' }).click();
    // Scoped to the table: the filter select has an option with the same text.
    await expect(main.getByRole('table').getByText('Yapay zeka, onay bekliyor')).toHaveCount(0);

    await main.locator('#i18n-source-filter').selectOption('AI');
    await expect(main.getByRole('row').filter({ hasText: 'common.itemCount.other' }).getByText('Yapay zeka', { exact: true })).toBeVisible();
  } finally {
    // Best-effort cleanup; never hide the real failure behind a cleanup error.
    await bff(page, 'DELETE', `admin/i18n/languages/${code}`).catch(() => undefined);
    await bff(page, 'DELETE', 'admin/ai/settings/key').catch(() => undefined);
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
