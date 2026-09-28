import { test, expect, type Page } from '@playwright/test';

/**
 * G1c public unsubscribe page (/m/u/<token>, docs/MESAJLASMA.md
 * "Abonelikten çıkma"). The opt-out itself (suppression, consent
 * revocation, idempotency) is covered against the database by the API e2e
 * suite; here the page is driven through the browser. Valid-token flows
 * answer the page's two BFF calls from the test so no seeded data is
 * changed; the invalid-token cases go through the real BFF and API.
 */

// Shape of a real token (<base64url payload>.<base64url HMAC>); its signature is not valid for the API.
const TOKEN = 'djE6dToxMTExMTExMS0yMjIyLTQzMzMtODQ0NC01NTU1NTU1NTU1NTU.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function stubUnsubscribeApi(page: Page, alreadyUnsubscribed = false): Promise<{ posts: number }> {
  const calls = { posts: 0 };
  await page.route(`**/api/bff/m/u/${TOKEN}`, async (route) => {
    if (route.request().method() === 'POST') {
      calls.posts += 1;
      await route.fulfill({ status: 200, json: { unsubscribed: true, alreadyUnsubscribed: false } });
      return;
    }
    await route.fulfill({
      status: 200,
      json: { studioName: 'Zen Reformer Pilates', channel: 'EMAIL', maskedAddress: 'a***@example.com', alreadyUnsubscribed },
    });
  });
  return calls;
}

test('shows who is asking, unsubscribes with one click and confirms (Turkish)', async ({ page }) => {
  const calls = await stubUnsubscribeApi(page);
  await page.goto(`/m/u/${TOKEN}`);

  await expect(page.getByRole('heading', { name: 'Abonelikten çık' })).toBeVisible();
  await expect(page.getByText('Zen Reformer Pilates tarafından E-posta kanalıyla', { exact: false })).toBeVisible();
  await expect(page.getByText('Adres: a***@example.com')).toBeVisible();
  await expect(page.getByText('işlemsel mesajlar gelmeye devam eder', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Abonelikten çık' }).click();
  await expect(page.getByRole('status')).toContainText('Aboneliğiniz iptal edildi');
  expect(calls.posts).toBe(1);
});

test('an address that already opted out sees that, without a second request', async ({ page }) => {
  const calls = await stubUnsubscribeApi(page, true);
  await page.goto(`/m/u/${TOKEN}`);
  await expect(page.getByRole('status')).toContainText('zaten abonelikten çıkmış');
  await expect(page.getByRole('button', { name: 'Abonelikten çık' })).toHaveCount(0);
  expect(calls.posts).toBe(0);
});

test('renders in English for an English browser', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await stubUnsubscribeApi(page);
  await page.goto(`/m/u/${TOKEN}`);
  await expect(page.getByRole('heading', { name: 'Unsubscribe' })).toBeVisible();
  await page.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(page.getByRole('status')).toContainText('You have been unsubscribed');
  await context.close();
});

test('a token with a bad signature is refused by the API and the page says the link is invalid', async ({ page }) => {
  await page.goto(`/m/u/${TOKEN}`);
  await expect(page.getByRole('alert').filter({ hasText: 'Bu bağlantı geçersiz.' })).toBeVisible();
});

test('a malformed token never reaches the API', async ({ page }) => {
  let proxied = 0;
  page.on('request', (req) => {
    if (req.url().includes('/api/bff/m/u/')) proxied += 1;
  });
  await page.goto('/m/u/not-a-token');
  await expect(page.getByRole('alert').filter({ hasText: 'Bu bağlantı geçersiz.' })).toBeVisible();
  expect(proxied).toBe(0);
});

test('a click link with a forged token lands on the site root, never on another host', async ({ page }) => {
  const response = await page.request.get(`/m/c/${TOKEN}`, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(new URL(response.headers()['location'] ?? '', 'http://localhost:3000').pathname).toBe('/');
});
