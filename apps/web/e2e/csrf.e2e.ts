import { test, expect } from '@playwright/test';
import { LOGINS, loginAs } from './support/login';

test('a POST to /api/bff without the CSRF header is rejected with 403', async ({ page }) => {
  await loginAs(page, LOGINS.owner);

  // A genuine same-origin browser fetch: the Origin header is sent
  // automatically, but the custom x-requested-with header is deliberately
  // left out to isolate that one check.
  const result = await page.evaluate(async () => {
    const res = await fetch('/api/bff/role-templates', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'should not be created', permissions: [] }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  });

  expect(result.status).toBe(403);
  expect(result.body?.message).toBe('Geçersiz istek kaynağı');
});
