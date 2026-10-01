import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD, LOGINS, loginAs } from './support/login';

/**
 * Visual record for the owner (docs/TASARIM.md, "Ekran görüntüleri"): full
 * page 1440x900 PNGs of the main screens in light and dark mode, saved to
 * apps/web/screenshots/<name>-<mode>.png and uploaded by CI as the
 * `web-screenshots` artifact. Only a failed navigation fails a test; a
 * screenshot that cannot be taken is recorded as an annotation instead, so
 * layout never breaks the suite.
 *
 * Dark mode is set the way the app does it: the signed-in tenant screens
 * read the user's saved appearance (PUT /me/appearance, restored at the
 * end), the public pages and the super admin console follow the OS setting
 * (emulated here).
 */

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: 'serial' });

const OUT_DIR = path.resolve(__dirname, '..', 'screenshots');
const MODES = ['light', 'dark'] as const;
type Mode = (typeof MODES)[number];
const CSRF = { 'x-requested-with': 'platform-web' };
const SUPER_ADMIN_PHONE = '+905321000001';

async function open(page: Page, url: string): Promise<void> {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  expect(response, `navigation to ${url}`).not.toBeNull();
  expect(response?.status() ?? 0, `status of ${url}`).toBeLessThan(400);
  // Let client data load; a page that never goes idle is still captured.
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
}

async function shoot(page: Page, name: string, mode: Mode): Promise<void> {
  try {
    await page.screenshot({ path: path.join(OUT_DIR, `${name}-${mode}.png`), fullPage: true, animations: 'disabled', timeout: 20_000 });
  } catch (err) {
    test.info().annotations.push({ type: 'screenshot-skipped', description: `${name}-${mode}: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function setAppearance(page: Page, colorScheme: 'LIGHT' | 'DARK' | 'SYSTEM', themeFamily: string | null): Promise<void> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.fetch('/api/bff/me/appearance', {
    method: 'PUT',
    headers: { ...CSRF, origin, 'content-type': 'application/json' },
    data: { themeFamily, colorScheme },
  });
  expect(res.status(), 'saving the appearance').toBeLessThan(400);
}

async function loginAsSuperAdmin(page: Page): Promise<void> {
  await page.goto('/giris');
  const form = page.locator('form').first();
  await form.locator('input:not([type="password"])').first().fill(SUPER_ADMIN_PHONE);
  await form.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/giris'));
}

for (const mode of MODES) {
  test(`public pages (${mode})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    await open(page, '/');
    await shoot(page, 'landing', mode);
    await open(page, '/giris');
    await shoot(page, 'login', mode);
  });

  test(`tenant panel (${mode})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    await loginAs(page, LOGINS.owner);
    const before = await page.request.get('/api/bff/me/appearance', { headers: CSRF });
    const original = before.ok() ? ((await before.json()) as { themeFamily: string | null; colorScheme: 'LIGHT' | 'DARK' | 'SYSTEM' }) : null;
    await setAppearance(page, mode === 'dark' ? 'DARK' : 'LIGHT', original?.themeFamily ?? null);
    try {
      await open(page, '/dashboard');
      await shoot(page, 'dashboard', mode);
      await open(page, '/calendar');
      await shoot(page, 'calendar', mode);
      await open(page, '/members');
      await shoot(page, 'members', mode);
      const firstMember = page.getByRole('main').locator('a[href^="/members/"]').first();
      if (await firstMember.count()) {
        await open(page, (await firstMember.getAttribute('href')) ?? '/members');
        await shoot(page, 'member-card', mode);
      }
      await open(page, '/ayarlar');
      await shoot(page, 'settings', mode);
    } finally {
      await setAppearance(page, original?.colorScheme ?? 'SYSTEM', original?.themeFamily ?? null);
    }
  });

  test(`super admin console (${mode})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    await loginAsSuperAdmin(page);
    await open(page, '/admin');
    await shoot(page, 'admin-home', mode);
    await open(page, '/admin/tenants');
    await shoot(page, 'admin-tenants', mode);
    await open(page, '/pazarlama');
    await shoot(page, 'marketing-dashboard', mode);
  });
}
