import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

test.describe('Authentication', () => {
  test('login sets httpOnly session cookies and BFF requests succeed', async ({ page, context }) => {
    await loginAs(page, LOGINS.owner);
    await expect(page).toHaveURL(/\/dashboard$/);

    // The browser-visible cookie jar must never carry the token cookies.
    const clientVisible = await page.evaluate(() => document.cookie);
    expect(clientVisible).not.toContain('pw_access');
    expect(clientVisible).not.toContain('pw_refresh');

    // They do exist server-side, as httpOnly cookies the browser cannot read.
    const cookies = await context.cookies();
    const access = cookies.find((c) => c.name === 'pw_access');
    const refresh = cookies.find((c) => c.name === 'pw_refresh');
    expect(access?.httpOnly).toBe(true);
    expect(access?.value).toBeTruthy();
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.value).toBeTruthy();

    // Authenticated calls through the BFF succeed with the cookie alone.
    const meStatus = await page.evaluate(async () => {
      const res = await fetch('/api/bff/auth/me', { credentials: 'same-origin' });
      return res.status;
    });
    expect(meStatus).toBe(200);
  });

  test('logout clears session cookies and further BFF calls are unauthenticated', async ({ page, context }) => {
    await loginAs(page, LOGINS.owner);

    await page.getByRole('button', { name: 'Çıkış yap' }).click();
    await page.waitForURL('**/giris');

    const cookies = await context.cookies();
    const access = cookies.find((c) => c.name === 'pw_access');
    const refresh = cookies.find((c) => c.name === 'pw_refresh');
    expect(access?.value ?? '').toBe('');
    expect(refresh?.value ?? '').toBe('');

    const meStatus = await page.evaluate(async () => {
      const res = await fetch('/api/bff/auth/me', { credentials: 'same-origin' });
      return res.status;
    });
    expect(meStatus).toBe(401);
  });

  test('unauthenticated access to /dashboard redirects to /giris', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/giris**');
    expect(new URL(page.url()).searchParams.get('sonra')).toBe('/dashboard');
  });
});
