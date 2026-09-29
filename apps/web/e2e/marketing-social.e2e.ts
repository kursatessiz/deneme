import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './support/login';

/**
 * M4b organic social publishing (docs/PAZARLAMA_MODULU.md 5.2, 6.1), driven
 * by the super admin against the deterministic fake publishers
 * (SOCIAL_FAKE_PROVIDER): a connection appears on the integrations hub with
 * a masked credential, a post is composed on /pazarlama/sosyal with the
 * network's own length counter, saved as a draft with its brand check, and
 * scheduled. Cleaned up through the API at the end so nothing stays behind.
 */

test.use({ actionTimeout: 15_000 });

const SUPER_ADMIN_PHONE = '+905321000001';
const CSRF = { 'x-requested-with': 'platform-web' };

async function bff<T>(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown): Promise<{ status: number; body: T }> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.fetch(`/api/bff/${path}`, {
    method,
    headers: { ...CSRF, origin, 'content-type': 'application/json' },
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

test('a social account is connected, a post is composed with the length counter and scheduled', async ({ page }) => {
  test.setTimeout(120_000);
  const run = Date.now().toString(36);
  await loginAsSuperAdmin(page);
  await page.goto('/pazarlama');

  const connection = await bff<{ id: string }>(page, 'POST', 'platform/integrations/social', {
    provider: 'META_PAGE',
    externalId: `e2e${run}`,
    displayName: `E2E sosyal ${run}`,
    credentials: { accessToken: `EAAB-e2e-${run}-token` },
  });
  expect(connection.status).toBe(201);

  try {
    // 1. The hub card shows the account with a masked credential only.
    await page.goto('/pazarlama/entegrasyonlar');
    const hub = page.getByRole('main');
    await expect(hub.getByText(`E2E sosyal ${run}`)).toBeVisible();
    await expect(hub.getByText('****oken')).toBeVisible();
    await expect(hub.getByText(`EAAB-e2e-${run}-token`)).toHaveCount(0);

    // 2. The composer counts characters the way the network does and saves a draft.
    await page.goto('/pazarlama/sosyal');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Yeni gönderi' }).click();
    await main.getByLabel('Hesap').selectOption({ label: `E2E sosyal ${run} (Facebook sayfası)` });
    await main.getByLabel('Metin').fill(`E2E gönderi ${run}`);
    await expect(main.getByTestId('social-counter')).toContainText('karakter');
    await main.getByRole('button', { name: 'Taslağı kaydet' }).click();
    await expect(main.getByText('Kaydedildi.')).toBeVisible();
    await expect(main.getByText('Sorun bulunmadı.')).toBeVisible();

    // 3. Scheduling a clean post is self-approved and shows as planned.
    const at = new Date(Date.now() + 2 * 3_600_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    await main.getByLabel('Yayın zamanı').fill(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`);
    await main.getByRole('button', { name: 'Planla' }).click();
    await expect(main.getByText('Gönderi planlandı.')).toBeVisible();
    await expect(main.getByText('Planlandı', { exact: true }).first()).toBeVisible();
  } finally {
    const posts = await bff<{ items: Array<{ id: string; connectionId: string; status: string }> }>(page, 'GET', `platform/marketing/social-posts?connectionId=${connection.body.id}`);
    for (const post of posts.body?.items ?? []) {
      await bff(page, 'POST', `platform/marketing/social-posts/${post.id}/cancel`, {});
      await bff(page, 'DELETE', `platform/marketing/social-posts/${post.id}`);
    }
    await bff(page, 'DELETE', `platform/integrations/social/${connection.body.id}`);
  }
});
