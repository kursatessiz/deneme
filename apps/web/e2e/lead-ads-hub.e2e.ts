import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './support/login';

/**
 * M4c integrations hub (docs/PAZARLAMA_MODULU.md 5.2): the Lead Ads block
 * with its form mapping editor, the SMS sender identity block and the
 * automation block on /pazarlama/entegrasyonlar and /admin/entegrasyonlar,
 * and the super-admin-only webhook verify token card. The Meta connection
 * and the form mapping it creates are removed at the end.
 */

test.use({ actionTimeout: 15_000 });

const SUPER_ADMIN_PHONE = '+905321000001';
const CSRF = { 'x-requested-with': 'platform-web' };
const FORM_ID = '9000000000123';

async function bff<T>(page: Page, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown, studioId?: string): Promise<{ status: number; body: T }> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.fetch(`/api/bff/${path}`, {
    method,
    headers: { ...CSRF, origin, 'content-type': 'application/json', ...(studioId ? { 'x-studio-id': studioId } : {}) },
    data,
    timeout: 30_000,
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function loginAsSuperAdmin(page: Page): Promise<void> {
  await page.goto('/giris');
  const form = page.locator('form').first();
  await form.locator('input:not([type="password"])').first().fill(SUPER_ADMIN_PHONE);
  await form.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/giris'));
}

test('the hub shows the lead ads, SMS sender and automation blocks and edits a form mapping', async ({ page }) => {
  test.setTimeout(120_000);
  const run = Date.now().toString(36);
  await loginAsSuperAdmin(page);

  const context = await bff<{ platformStudioId: string }>(page, 'GET', 'platform/context');
  expect(context.status).toBe(200);
  const studioId = context.body.platformStudioId;
  const connection = await bff<{ id: string }>(
    page,
    'POST',
    `studios/${studioId}/ads/connections`,
    { platform: 'META', label: `E2E M4c ${run}`, externalAccountId: 'act_9000', credentials: { accessToken: 'EAAB-m4c-e2e-token-0000', pixelId: '900000000000001' } },
    studioId,
  );
  expect(connection.status).toBe(201);

  try {
    await page.goto('/pazarlama/entegrasyonlar');
    const main = page.getByRole('main');
    await expect(main.getByText('Meta Lead Ads (aday formları)')).toBeVisible();
    await expect(main.getByText('SMS gönderici kimliği')).toBeVisible();
    await expect(main.getByText('Otomasyon (Zapier, Make, n8n)')).toBeVisible();
    await expect(main.getByText('studio.signup')).toBeVisible();
    // The verify token belongs to the super admin console only.
    await expect(main.getByText('Webhook doğrulama belirteci')).toHaveCount(0);

    // The form mapping editor: one mapped question and a consent question.
    await main.getByRole('button', { name: 'Form ekle' }).click();
    await main.getByLabel('Form kimliği').fill(FORM_ID);
    await main.getByRole('button', { name: 'Soru ekle' }).click();
    await main.getByLabel('Soru anahtarı').first().fill('your_mail');
    await main.getByLabel('Kişi alanı').first().selectOption('email');
    await main.getByLabel('İzin sorusunun anahtarı').fill('marketing_ok');
    await main.getByRole('button', { name: 'Eşlemeyi kaydet' }).click();
    await expect(main.getByText(FORM_ID)).toBeVisible();
    await expect(main.getByText('İzin sorusu: marketing_ok')).toBeVisible();

    await page.goto('/admin/entegrasyonlar');
    await expect(page.getByRole('main').getByText('Webhook doğrulama belirteci')).toBeVisible();
  } finally {
    await bff(page, 'DELETE', `platform/integrations/lead-ads/forms/${FORM_ID}`);
    await bff(page, 'DELETE', `studios/${studioId}/ads/connections/${connection.body.id}`, undefined, studioId);
  }
});
