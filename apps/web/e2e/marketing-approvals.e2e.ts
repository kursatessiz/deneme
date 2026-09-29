import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './support/login';

/**
 * M3b marketing approvals (docs/PAZARLAMA_MODULU.md 6.1), driven by the
 * super admin: a platform campaign submitted from the campaign screen waits
 * for approval (first-time segment), shows up on /pazarlama/onaylar with its
 * precheck summary, and the super admin approves their own request, which is
 * recorded as self-approved. The super admin settings page saves a
 * threshold. The campaign is cancelled at the end so nothing is sent.
 */

test.use({ actionTimeout: 15_000 });

const SUPER_ADMIN_PHONE = '+905321000001';
const CSRF = { 'x-requested-with': 'platform-web' };

async function bff<T>(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown, studioId?: string): Promise<{ status: number; body: T }> {
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

test('a platform campaign waits for approval, is reviewed on the approvals page and approved', async ({ page }) => {
  test.setTimeout(150_000);
  const run = Date.now().toString(36);
  await loginAsSuperAdmin(page);

  const context = await bff<{ platformStudioId: string }>(page, 'GET', 'platform/context');
  expect(context.status).toBe(200);
  const studioId = context.body.platformStudioId;
  const segment = await bff<{ id: string }>(page, 'POST', `studios/${studioId}/segments`, { name: `E2E M3b ${run}`, kind: 'STATIC' }, studioId);
  expect(segment.status).toBe(201);
  const campaign = await bff<{ id: string }>(
    page,
    'POST',
    `studios/${studioId}/campaigns`,
    { name: `E2E M3b kampanya ${run}`, segmentId: segment.body.id, channel: 'SMS', templateKey: 'WIN_BACK' },
    studioId,
  );
  expect(campaign.status).toBe(201);

  // 1. The campaign screen offers "Onaya gönder" instead of a direct send.
  await page.goto(`/pazarlama/kampanyalar/${campaign.body.id}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('button', { name: 'Şimdi gönder' })).toHaveCount(0);
  await main.getByRole('button', { name: 'Onaya gönder' }).click();
  await expect(main.getByText('Süper admin onayı bekleniyor. Onaylanana kadar gönderilmez.').first()).toBeVisible();
  await expect(main.getByText('Onay bekliyor', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Onaya gönder' })).toBeDisabled();

  // 2. The approvals page lists it; the drawer shows the precheck summary.
  await main.getByRole('link', { name: 'Onay talebini aç' }).click();
  await page.waitForURL(/\/pazarlama\/onaylar/);
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: `E2E M3b kampanya ${run}` })).toBeVisible();
  await expect(drawer.getByText('Segment ilk kez kullanılıyor')).toBeVisible();
  await expect(drawer.getByText('Segment boş.')).toBeVisible();
  await expect(drawer.getByText('Para birimiyle fiyatlanan bir kanal yok; SMS maliyeti kredi olarak gösterilir.')).toBeVisible();

  // 3. The super admin approves their own request: recorded as self-approved.
  await drawer.getByRole('button', { name: 'Onayla' }).click();
  await expect(drawer.getByText('Talep onaylandı.')).toBeVisible();
  await expect(drawer.getByText('Süper admin kendi talebini onayladı.')).toBeVisible();
  await drawer.getByRole('button', { name: 'Kapat' }).click();

  await page.getByLabel('Durum').selectOption('SELF_APPROVED');
  await expect(page.getByRole('main').getByText(`E2E M3b kampanya ${run}`)).toBeVisible();

  // 4. Settings page (super admin): the TTL saves.
  await page.goto('/admin/pazarlama-ayarlari');
  await expect(page.getByRole('heading', { name: 'Pazarlama ayarları' })).toBeVisible();
  await page.getByLabel('Onay talebinin geçerlilik süresi (saat)').fill('72');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Ayarlar kaydedildi.')).toBeVisible();

  // Nothing is sent: cancel the campaign.
  expect((await bff(page, 'POST', `studios/${studioId}/campaigns/${campaign.body.id}/cancel`, {}, studioId)).status).toBe(201);
});
