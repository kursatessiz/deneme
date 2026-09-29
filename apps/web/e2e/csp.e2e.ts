import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

// Defense-in-depth CSP on the authenticated dashboard (see
// src/lib/security/csp.ts and the dashboard branch of middleware.ts).
test.describe('Dashboard Content-Security-Policy', () => {
  test('dashboard responses carry a strict nonce-based CSP and the page renders cleanly', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await loginAs(page, LOGINS.owner);

    const response = await page.goto('/dashboard');
    expect(response).not.toBeNull();

    const csp = response?.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain('nonce-');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");

    // The page rendered rather than being blocked by its own policy.
    await expect(page.getByRole('main')).toBeVisible();

    const cspErrors = consoleErrors.filter((text) => text.includes('Content Security Policy'));
    expect(cspErrors).toEqual([]);
  });
});
