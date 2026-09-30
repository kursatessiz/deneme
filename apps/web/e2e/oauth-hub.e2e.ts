import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './support/login';

/**
 * M4a OAuth connect on the integrations hub (docs/PAZARLAMA_MODULU.md 5.2):
 * the "Hesap bağlama (OAuth)" block on both hub pages, the super-admin-only
 * client settings card (secret masked after saving), the connect form
 * appearing once a client is configured, and the landing banner the
 * callback redirect produces. No provider is contacted: the connect button
 * is not pressed. The client setting is removed at the end.
 */

test.use({ actionTimeout: 15_000 });

const SUPER_ADMIN_PHONE = '+905321000001';
const CSRF = { 'x-requested-with': 'platform-web' };
const SECRET = 'm4a-playwright-linkedin-secret';

async function bff<T>(page: Page, method: 'GET' | 'PUT' | 'DELETE', path: string, data?: unknown): Promise<{ status: number; body: T }> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.fetch(`/api/bff/${path}`, { method, headers: { ...CSRF, origin, 'content-type': 'application/json' }, data, timeout: 30_000 });
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

test('the hub shows the OAuth block, the masked client card and the landing banner', async ({ page }) => {
  test.setTimeout(120_000);
  await loginAsSuperAdmin(page);
  const saved = await bff<{ configured: boolean; clientSecretPreview: string }>(page, 'PUT', 'admin/integrations/oauth/linkedin', { clientId: 'm4a-playwright-client', clientSecret: SECRET });
  expect(saved.status).toBe(200);
  expect(saved.body.clientSecretPreview).toBe(`****${SECRET.slice(-4)}`);

  try {
    await page.goto('/pazarlama/entegrasyonlar');
    const main = page.getByRole('main');
    await expect(main.getByText('Hesap bağlama (OAuth)')).toBeVisible();
    await expect(main.getByRole('button', { name: 'LinkedIn ile bağlan' })).toBeVisible();
    // The client settings card belongs to the super admin console only.
    await expect(main.getByText('OAuth istemci bilgileri (yalnızca süper admin)')).toHaveCount(0);

    await page.goto('/admin/entegrasyonlar?oauth=error&provider=google&reason=DENIED');
    const admin = page.getByRole('main');
    await expect(admin.getByText('Google Ads bağlantısı tamamlanamadı: onay verilmedi veya iptal edildi.')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/entegrasyonlar$/);
    await expect(admin.getByText('OAuth istemci bilgileri (yalnızca süper admin)')).toBeVisible();
    await expect(admin.getByText(SECRET)).toHaveCount(0);
    await expect(admin.getByText('/platform/integrations/oauth/linkedin/callback')).toBeVisible();
  } finally {
    await bff(page, 'DELETE', 'admin/integrations/oauth/linkedin');
  }
});
